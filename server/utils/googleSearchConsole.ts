import { parseURL } from 'ufo'
import type { Credentials } from 'google-auth-library'
import { OAuth2Client } from 'googleapis-common'
import { searchconsole } from '@googleapis/searchconsole'
import type { GoogleSearchConsoleSite, SiteAnalytics, User } from '~/types'
import { normalizeSiteUrl } from '~/server/utils/formatting'

function formatDate(date: Date = new Date()) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

export function createGoogleOAuthClient(credentials: Credentials) {
  const oauth2Client = new OAuth2Client({
    // tells client to use the refresh_token...
    forceRefreshOnFailure: true,
  })
  oauth2Client.setCredentials(credentials)
  return oauth2Client
}

export async function fetchGoogleSearchConsoleSites(credentials: Credentials): Promise<GoogleSearchConsoleSite[]> {
  const api = searchconsole({
    version: 'v1',
    auth: createGoogleOAuthClient(credentials),
  })
  return api.sites.list().then(res => res.data.siteEntry! as GoogleSearchConsoleSite[])
}

export async function fetchGoogleSearchConsoleAnalytics(credentials: Credentials, periodRange: User['analyticsPeriod'], siteUrl: string): Promise<SiteAnalytics> {
  const api = searchconsole({
    version: 'v1',
    auth: createGoogleOAuthClient(credentials),
  })

  const periodDays = periodRange.includes('d')
    ? Number.parseInt(periodRange.replace('d', ''))
    : (Number.parseInt(periodRange.replace('mo', '')) * 30)
  const startPeriod = new Date()
  startPeriod.setDate(new Date().getDate() - periodDays)
  const startPrevPeriod = new Date()
  startPrevPeriod.setDate(new Date().getDate() - periodDays * 2)
  const endPrevPeriod = new Date()
  endPrevPeriod.setDate(new Date().getDate() - periodDays - 1)

  const requestBody = {
    dimensions: ['page'],
    type: 'web',
    aggregationType: 'byPage',
  }
  const [keywordsPeriod, keywordsPrevPeriod, period, prevPeriod, graph] = (await Promise.all([
    // do a query based on keywords instead of dates
    api.searchanalytics.query({
      siteUrl,
      requestBody: {
        ...requestBody,
        // 1 month
        startDate: formatDate(startPeriod),
        endDate: formatDate(),
        // keywords
        dimensions: ['query'],
      },
    }),
    api.searchanalytics.query({
      siteUrl,
      requestBody: {
        ...requestBody,
        // 1 month
        startDate: formatDate(startPrevPeriod),
        endDate: formatDate(endPrevPeriod),
        // keywords
        dimensions: ['query'],
      },
    }),
    api.searchanalytics.query({
      siteUrl,
      requestBody: {
        ...requestBody,
        // 1 month
        startDate: formatDate(startPeriod),
        endDate: formatDate(),
      },
    }),
    api.searchanalytics.query({
      siteUrl,
      requestBody: {
        ...requestBody,
        startDate: formatDate(startPrevPeriod),
        endDate: formatDate(endPrevPeriod),
      },
    }),
    // do another query but do it based on clicks / impressions for the day
    api.searchanalytics.query({
      siteUrl,
      requestBody: {
        ...requestBody,
        startDate: formatDate(startPrevPeriod),
        endDate: formatDate(),
        dimensions: ['date'],
      },
    }),
  ]))
    .map(res => res.data.rows || [])
  const analytics = {
    // compute analytics from calcualting each url stats togethor
    period: {
      totalClicks: period!.reduce((acc, row) => acc + row.clicks!, 0),
      totalImpressions: period!.reduce((acc, row) => acc + row.impressions!, 0),
    },
    prevPeriod: {
      totalClicks: prevPeriod!.reduce((acc, row) => acc + row.clicks!, 0),
      totalImpressions: prevPeriod!.reduce((acc, row) => acc + row.impressions!, 0),
    },
  }
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl)
  const indexedUrls = period!
    .map(r => r.keys![0].replace('www.', '')) // doman property using www.
    // strip out subdomains, hash and query
    .filter(r => !r.includes('#') && !r.includes('?')
    // fix www.
    && r.startsWith(normalizedSiteUrl),
    )

  const sitemaps = await api.sitemaps.list({
    siteUrl,
  })
    .then(res => res.data.sitemap || [])
  return {
    analytics,
    sitemaps,
    indexedUrls,
    period: period.map((row) => {
      const prevPeriodRow = prevPeriod.find(r => r.keys![0] === row.keys![0])
      return {
        url: parseURL(row.keys![0]).pathname,
        clicks: row.clicks!,
        clicksPercent: (prevPeriodRow ? (row.clicks! - prevPeriodRow.clicks!) / prevPeriodRow.clicks! : 0),
        impressions: row.impressions!,
        impressionsPercent: (prevPeriodRow ? (row.impressions! - prevPeriodRow.impressions!) / prevPeriodRow.impressions! : 0),
      } satisfies SiteAnalytics['period'][0]
    }),
    keywords: keywordsPeriod.map((row) => {
      const prevPeriodRow = keywordsPrevPeriod.find(r => r.keys![0] === row.keys![0])
      return {
        keyword: row.keys![0],
        // position and ctr
        position: row.position!,
        positionPercent: (prevPeriodRow ? (row.position! - prevPeriodRow.position!) / prevPeriodRow.position! : 0),
        ctr: row.ctr!,
        ctrPercent: (prevPeriodRow ? (row.ctr! - prevPeriodRow.ctr!) / prevPeriodRow.ctr! : 0),
        clicks: row.clicks!,
      } satisfies SiteAnalytics['keywords'][0]
    }),
    graph: graph.map((row) => {
      // fix key
      return {
        clicks: row.clicks!,
        impressions: row.impressions!,
        time: row.keys![0],
        keys: undefined,
      } satisfies SiteAnalytics['graph'][0]
    }),
  }
}
