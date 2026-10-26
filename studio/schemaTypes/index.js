import {advertiseTier} from './advertiseTier.js'
import {event} from './event.js'
import {newsAggregator, newsAggregatorState, newsPublishSignal} from './newsAggregator.js'
import {newsArticle} from './newsArticle.js'
import {newsSource} from './newsSource.js'
import {assetClass, capitalType} from './newsTaxonomy.js'
import {page} from './page.js'
import {socialHighlight} from './socialHighlight.js'
import {sponsorItem} from './sponsorItem.js'

export const schemaTypes = [
  newsArticle,
  newsSource,
  capitalType,
  assetClass,
  newsAggregator,
  newsAggregatorState,
  newsPublishSignal,
  sponsorItem,
  event,
  socialHighlight,
  advertiseTier,
  page,
]
