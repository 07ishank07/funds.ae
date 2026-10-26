// Document actions for the News Review Queue. Every decision is computed by the pure
// functions in schemaTypes/newsWorkflow.js (tested by backend/test/workflow.test.js);
// these components only collect input, show the reasons when something is blocked, and
// apply the result: patch the story, publish it, and touch the newsPublishSignal document
// so the Sanity webhook republishes the site's news.
//
// Approve, Approve and publish, Publish now and Schedule are for listed approvers only
// (NEWS_APPROVER_IDS). The backend checks the approver, the content hash and the licence
// again before anything reaches the site, so these buttons are a convenience, not the gate.

import {useState} from 'react'
import {useClient, useCurrentUser, useDocumentOperation} from 'sanity'
import {Button, Flex, Stack, Text, TextArea, TextInput} from '@sanity/ui'
import {NEWS_ACTIONS, NEWS_APPROVER_IDS, NEWS_LIMITS} from '../schemaTypes/newsRules.js'
import {planAction, planSave} from '../schemaTypes/newsWorkflow.js'

const API_VERSION = '2025-02-19'
const SIGNAL_ID = 'newsPublishSignal'
const FETCH_COOLDOWN_MS = 10 * 60_000

async function sourceLicense(client, doc) {
  const ref = doc?.source?._ref
  return ref ? client.fetch('*[_id == $ref][0].licenseStatus', {ref}) : undefined
}

function signal(client, action) {
  return client.createOrReplace({_id: SIGNAL_ID, _type: 'newsPublishSignal', changedAt: new Date().toISOString(), action})
}

function reasonsDialog(header, reasons, onClose) {
  return {
    type: 'dialog',
    header,
    onClose,
    content: (
      <Stack space={3}>
        {reasons.map((reason) => (
          <Text key={reason} size={1}>
            • {reason}
          </Text>
        ))}
      </Stack>
    ),
  }
}

function ReasonForm({onSubmit, onCancel}) {
  const [reason, setReason] = useState('')
  const [min, max] = NEWS_LIMITS.rejectionReason
  const ok = reason.trim().length >= min && reason.trim().length <= max
  return (
    <Stack space={3}>
      <Text size={1}>Why is this story not right for funds.ae? Editors see the reason later.</Text>
      <TextArea rows={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={max} />
      <Flex gap={2} justify="flex-end">
        <Button mode="ghost" text="Cancel" onClick={onCancel} />
        <Button tone="critical" text="Reject" disabled={!ok} onClick={() => onSubmit({reason})} />
      </Flex>
    </Stack>
  )
}

function ScheduleForm({onSubmit, onCancel}) {
  const [value, setValue] = useState('')
  return (
    <Stack space={3}>
      <Text size={1}>
        The story goes on the site at this time (your computer&apos;s time zone), within about an hour. It must be at least{' '}
        {NEWS_LIMITS.scheduleLeadMinutes} minutes from now.
      </Text>
      <TextInput type="datetime-local" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
      <Flex gap={2} justify="flex-end">
        <Button mode="ghost" text="Cancel" onClick={onCancel} />
        <Button tone="primary" text="Schedule" disabled={!value} onClick={() => onSubmit({scheduleAt: new Date(value).toISOString()})} />
      </Flex>
    </Stack>
  )
}

const TONES = {
  approve: 'positive',
  approvePublish: 'positive',
  publish: 'positive',
  schedule: 'primary',
  reject: 'critical',
  unpublish: 'caution',
  archive: 'caution',
  returnToReview: 'default',
}

function makeWorkflowAction(name) {
  const spec = NEWS_ACTIONS[name]
  function WorkflowAction(props) {
    const doc = props.draft || props.published
    const user = useCurrentUser()
    const client = useClient({apiVersion: API_VERSION})
    const {patch, publish} = useDocumentOperation(props.id, props.type)
    const [dialog, setDialog] = useState(null)
    const [busy, setBusy] = useState(false)
    const status = doc?.status || 'pending_review'
    if (!doc || !spec.from.includes(status)) return null
    const isApprover = Boolean(user && NEWS_APPROVER_IDS.includes(user.id))
    const close = () => setDialog(null)

    async function apply(input = {}) {
      setBusy(true)
      try {
        // Record who wrote the summary before the approval is stamped: summarySource is part of the approval hash.
        const source = summarySourceOf(doc)
        const current = source && source !== doc.summarySource ? {...doc, summarySource: source} : doc
        const plan = planAction(name, current, {
          userId: user?.id,
          userName: user?.name,
          approverIds: NEWS_APPROVER_IDS,
          now: new Date(),
          sourceLicenseStatus: await sourceLicense(client, doc),
          ...input,
        })
        if (!plan.ok) {
          setDialog(reasonsDialog(`${spec.label}: not possible yet`, plan.reasons, close))
          return
        }
        const set = current === doc ? plan.set : {...plan.set, summarySource: source}
        patch.execute(plan.unset.length ? [{set}, {unset: plan.unset}] : [{set}])
        publish.execute()
        await signal(client, name)
        close()
        props.onComplete()
      } catch (err) {
        setDialog(reasonsDialog('Something went wrong', [String(err?.message || err), 'Nothing was published. Try again.'], close))
      } finally {
        setBusy(false)
      }
    }

    return {
      label: busy ? `${spec.label}…` : spec.label,
      tone: TONES[name],
      disabled: busy || (spec.approverOnly && !isApprover),
      title: spec.approverOnly && !isApprover ? 'Only approvers can do this. See docs/NEWS-REVIEW-GUIDE.md, "Approvers".' : undefined,
      dialog,
      onHandle: () => {
        if (name === 'reject') {
          setDialog({type: 'dialog', header: 'Reject this story', onClose: close, content: <ReasonForm onSubmit={apply} onCancel={close} />})
        } else if (name === 'schedule') {
          setDialog({type: 'dialog', header: 'Schedule this story', onClose: close, content: <ScheduleForm onSubmit={apply} onCancel={close} />})
        } else {
          apply()
        }
      },
    }
  }
  WorkflowAction.action = `news-${name}`
  WorkflowAction.displayName = `News${name[0].toUpperCase()}${name.slice(1)}Action`
  return WorkflowAction
}

/** In the order they appear in the Studio's action menu. */
export const newsWorkflowActions = ['approvePublish', 'approve', 'publish', 'schedule', 'reject', 'unpublish', 'archive', 'returnToReview'].map(makeWorkflowAction)

/** Where the summary came from, so the site and the editors can tell an excerpt from our own words. */
function summarySourceOf(doc) {
  if (!doc?.summary) return undefined
  if (doc.summary === doc.excerpt) return 'excerpt'
  if (doc.classification?.suggestedSummary && doc.summary === doc.classification.suggestedSummary) return 'ai'
  return 'editor'
}

/**
 * Sanity's own Publish, renamed "Save changes" so it is not confused with putting a story on the site.
 * On an approved or live story only an approver can save, every check must still pass, and the
 * approval is re-stamped for the new content (planSave).
 */
export function withNewsSave(PublishAction) {
  function NewsSaveAction(props) {
    const original = PublishAction(props)
    const user = useCurrentUser()
    const client = useClient({apiVersion: API_VERSION})
    const {patch} = useDocumentOperation(props.id, props.type)
    const [dialog, setDialog] = useState(null)
    if (!original) return original
    const close = () => setDialog(null)
    return {
      ...original,
      label: 'Save changes',
      dialog: dialog || original.dialog,
      onHandle: async () => {
        const doc = props.draft || props.published
        const set = {}
        const source = summarySourceOf(doc)
        if (source && source !== doc?.summarySource) set.summarySource = source
        const live = doc?.status === 'approved' || doc?.status === 'published'
        if (live) {
          // The approval is stamped for the content as saved, including the updated summarySource.
          const plan = planSave({...doc, ...set}, {
            userId: user?.id,
            userName: user?.name,
            approverIds: NEWS_APPROVER_IDS,
            now: new Date(),
            sourceLicenseStatus: await sourceLicense(client, doc),
          })
          if (!plan.ok) {
            setDialog(reasonsDialog('These changes cannot be saved yet', plan.reasons, close))
            return
          }
          Object.assign(set, plan.set)
        }
        if (Object.keys(set).length) patch.execute([{set}])
        original.onHandle()
        if (doc?.status === 'published') await signal(client, 'save')
      },
    }
  }
  NewsSaveAction.action = 'publish'
  return NewsSaveAction
}

/** "Fetch News Now" on the News aggregator document: the webhook starts the News ingest action. */
export function FetchNewsNowAction(props) {
  const user = useCurrentUser()
  const {patch, publish} = useDocumentOperation(props.id, props.type)
  const doc = props.draft || props.published
  const last = doc?.fetchRequestedAt ? new Date(doc.fetchRequestedAt).getTime() : 0
  const wait = FETCH_COOLDOWN_MS - (Date.now() - last)
  return {
    label: 'Fetch News Now',
    tone: 'primary',
    disabled: wait > 0,
    title:
      wait > 0
        ? `A fetch was requested a few minutes ago. Try again in ${Math.ceil(wait / 60_000)} min.`
        : 'Fetch every source now. New stories arrive in Pending review within a few minutes.',
    onHandle: () => {
      patch.execute([{set: {fetchRequestedAt: new Date().toISOString(), fetchRequestedBy: user?.name || user?.id || 'editor'}}])
      publish.execute()
      props.onComplete()
    },
  }
}
FetchNewsNowAction.action = 'news-fetch-now'
