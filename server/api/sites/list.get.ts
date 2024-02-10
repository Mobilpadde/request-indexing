import { fetchSitesCached } from '~/server/utils/siteCache'

export default defineEventHandler((event) => {
  return fetchSitesCached(event.context.authenticatedData, String(getQuery(event).force) === 'true')
})
