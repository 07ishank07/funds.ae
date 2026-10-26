// Read-only fetch health for one news source, as the importer last recorded it in the
// newsAggregatorState document (backend/src/repositories/newsReview.sanity.js).

import {useEffect, useState} from 'react'
import {useClient, useFormValue} from 'sanity'
import {Card, Stack, Text} from '@sanity/ui'

const API_VERSION = '2025-02-19'
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'never')

export function SourceHealthInput() {
  const id = useFormValue(['id', 'current'])
  const client = useClient({apiVersion: API_VERSION})
  const [health, setHealth] = useState(undefined)

  useEffect(() => {
    let live = true
    if (!id) {
      setHealth(null)
      return undefined
    }
    client
      .fetch('*[_id == "newsAggregatorState"][0]{updatedAt, "source": sources[id == $id][0]}', {id})
      .then((result) => live && setHealth(result || null))
      .catch(() => live && setHealth(null))
    return () => {
      live = false
    }
  }, [client, id])

  if (health === undefined) return <Text size={1} muted>Loading…</Text>
  const s = health?.source
  if (!s) {
    return (
      <Card padding={3} border tone="transparent">
        <Text size={1}>No fetch recorded yet. The importer fills this in after its next run.</Text>
      </Card>
    )
  }
  const healthy = s.status === 'ok' || s.status === 'not-modified'
  return (
    <Card padding={3} border tone={healthy ? 'positive' : 'caution'}>
      <Stack space={3}>
        <Text size={1}>Status: {s.status || 'unknown'}</Text>
        <Text size={1}>Last successful fetch: {when(s.lastSuccessAt)}</Text>
        <Text size={1}>Last attempt: {when(s.lastFetchedAt)}</Text>
        <Text size={1}>Items in the feed last time: {s.lastItemCount ?? 'unknown'}</Text>
        {s.lastError ? <Text size={1}>Last error: {s.lastError}</Text> : null}
        {s.consecutiveFailures ? <Text size={1}>Failures in a row: {s.consecutiveFailures}</Text> : null}
        {s.pausedUntil ? <Text size={1}>Paused until {when(s.pausedUntil)}. Fix the feed address, then ask a developer to run reset-feed.</Text> : null}
        <Text size={1} muted>Recorded {when(health.updatedAt)}.</Text>
      </Stack>
    </Card>
  )
}
