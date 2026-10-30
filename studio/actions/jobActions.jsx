// Document actions for jobs in the Careers section. Every decision is computed by the pure functions in
// schemaTypes/jobWorkflow.js (tested by backend/test/jobs.test.js); these components only collect input,
// show the reasons when something is blocked, and apply the result: patch the job, publish it, and touch
// the newsPublishSignal document so the Sanity webhook republishes the site.
//
// Approve and publish is for review approvers only (NEWS_APPROVER_IDS). The backend checks the approver,
// the content hash and the expiry again before a job reaches the site, so these buttons are a convenience,
// not the gate.

import {useState} from 'react'
import {useCurrentUser, useClient, useDocumentOperation} from 'sanity'
import {Button, Flex, Stack, Text, TextArea} from '@sanity/ui'
import {NEWS_APPROVER_IDS} from '../schemaTypes/newsRules.js'
import {JOB_ACTIONS, JOB_LIMITS} from '../schemaTypes/jobRules.js'
import {planJobAction, planJobSave} from '../schemaTypes/jobWorkflow.js'
import {reasonsDialog, signal} from './newsActions.jsx'

const API_VERSION = '2025-02-19'
const TONES = {approvePublish: 'positive', reject: 'critical', unpublish: 'caution', archive: 'default'}

function RejectForm({onSubmit, onCancel}) {
  const [reason, setReason] = useState('')
  const [min, max] = JOB_LIMITS.rejectionReason
  const ok = reason.trim().length >= min && reason.trim().length <= max
  return (
    <Stack space={3}>
      <Text size={1}>Why is this job not right for funds.ae (for example an agency repost, or not a financial services role)? Editors see the reason later.</Text>
      <TextArea rows={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={max} />
      <Flex gap={2} justify="flex-end">
        <Button mode="ghost" text="Cancel" onClick={onCancel} />
        <Button tone="critical" text="Reject" disabled={!ok} onClick={() => onSubmit({reason})} />
      </Flex>
    </Stack>
  )
}

function makeJobAction(name) {
  const spec = JOB_ACTIONS[name]
  function JobAction(props) {
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
        const plan = planJobAction(name, doc, {userId: user?.id, userName: user?.name, approverIds: NEWS_APPROVER_IDS, now: new Date(), ...input})
        if (!plan.ok) {
          setDialog(reasonsDialog(`${spec.label}: not possible yet`, plan.reasons, close))
          return
        }
        patch.execute(plan.unset.length ? [{set: plan.set}, {unset: plan.unset}] : [{set: plan.set}])
        publish.execute()
        await signal(client, `job-${name}`)
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
        if (name === 'reject') setDialog({type: 'dialog', header: 'Reject this job', onClose: close, content: <RejectForm onSubmit={apply} onCancel={close} />})
        else apply()
      },
    }
  }
  JobAction.action = `job-${name}`
  JobAction.displayName = `Job${name[0].toUpperCase()}${name.slice(1)}Action`
  return JobAction
}

/** In the order they appear in the Studio's action menu. */
export const jobWorkflowActions = ['approvePublish', 'reject', 'unpublish', 'archive'].map(makeJobAction)

/**
 * Sanity's own Publish on a job, renamed "Save changes". On a live job only an approver can save, every check
 * must still pass, and the approval is re-stamped for the new content (planJobSave).
 */
export function withJobSave(PublishAction) {
  function JobSaveAction(props) {
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
        const plan = planJobSave(doc, {userId: user?.id, userName: user?.name, approverIds: NEWS_APPROVER_IDS, now: new Date()})
        if (!plan.ok) {
          setDialog(reasonsDialog('These changes cannot be saved yet', plan.reasons, close))
          return
        }
        if (Object.keys(plan.set).length) patch.execute([{set: plan.set}])
        original.onHandle()
        if (doc?.status === 'published') await signal(client, 'job-save')
      },
    }
  }
  JobSaveAction.action = 'publish'
  return JobSaveAction
}
