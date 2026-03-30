import { useState, useCallback, useRef } from 'react'
import { Upload, FileText, AudioLines, Loader2, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { cn } from '@/lib/utils'

const TRANSCRIPT_EXTENSIONS = ['.vtt', '.txt', '.md', '.srt']
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.webm']
const ALL_ACCEPT = [
  ...TRANSCRIPT_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  'audio/*',
  'text/*',
].join(',')

type FileKind = 'transcript' | 'audio'

function detectFileKind(file: File): FileKind {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (AUDIO_EXTENSIONS.includes(ext) || file.type.startsWith('audio/')) {
    return 'audio'
  }
  return 'transcript'
}

interface UploadViewProps {
  onAnalysisComplete: (meetingId: string, aiOutput: AiOutput) => void
  provider?: string
}

type UploadStatus = 'idle' | 'uploading' | 'analyzing' | 'done'

export function UploadView({ onAnalysisComplete, provider }: UploadViewProps) {
  const [file, setFile] = useState<File | null>(null)
  const [fileKind, setFileKind] = useState<FileKind>('transcript')
  const [pastedText, setPastedText] = useState('')
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [isDragOver, setIsDragOver] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    return () => { eventSourceRef.current?.close() }
  }, [])

  const handleFileDrop = useCallback((files: FileList | null) => {
    if (!files?.length) return
    const droppedFile = files[0]
    setFile(droppedFile)
    setFileKind(detectFileKind(droppedFile))
    setPastedText('')
  }, [])

  const clearFile = () => {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canSubmit = (file || pastedText.trim()) && status === 'idle'

  const handleSubmit = async () => {
    if (!canSubmit) return
    try {
      setStatus('uploading')
      let meetingId: string

      if (file) {
        const formData = new FormData()
        formData.append('file', file)
        if (fileKind === 'audio') {
          const result = await api.uploadAudio(formData)
          meetingId = result.meeting_id
        } else {
          const result = await api.uploadTranscript(formData)
          meetingId = result.meeting_id
        }
      } else {
        const blob = new Blob([pastedText], { type: 'text/plain' })
        const textFile = new File([blob], 'pasted-transcript.txt', { type: 'text/plain' })
        const formData = new FormData()
        formData.append('file', textFile)
        const result = await api.uploadTranscript(formData)
        meetingId = result.meeting_id
      }

      // Navigate to meeting page immediately — it will handle SSE streaming
      // Kick off analysis in the background (don't await)
      api.analyze(meetingId, provider).catch(() => {})
      setStatus('done')
      onAnalysisComplete(meetingId, {} as any)
    } catch (err) {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      setStatus('idle')
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const isProcessing = status !== 'idle'

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <h2 className="text-base font-semibold text-[var(--bb-text-primary)]">Upload Meeting</h2>
        <p className="mt-0.5 text-sm text-[var(--bb-text-muted)]">
          Drop a transcript or audio file, or paste text directly.
        </p>
      </div>

      {/* Horizontal layout: drop zone + paste area side by side */}
      <div className="flex gap-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragOver(false)
            handleFileDrop(e.dataTransfer.files)
          }}
          onClick={() => !file && fileInputRef.current?.click()}
          className={cn(
            'flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-8 py-12 transition-colors',
            isDragOver
              ? 'border-[var(--bb-accent)] bg-[var(--bb-accent)]/5'
              : 'border-[var(--bb-border)] hover:border-[var(--bb-text-muted)]',
            file && 'cursor-default border-solid border-[var(--bb-border)] bg-[var(--bb-border-light)]'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ALL_ACCEPT}
            className="hidden"
            onChange={(e) => handleFileDrop(e.target.files)}
          />

          {file ? (
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex size-10 items-center justify-center rounded-lg',
                fileKind === 'audio' ? 'bg-purple-100 text-purple-600' : 'bg-blue-50 text-[var(--bb-accent)]'
              )}>
                {fileKind === 'audio' ? <AudioLines className="size-5" /> : <FileText className="size-5" />}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-[var(--bb-text-primary)]">{file.name}</p>
                <p className="text-xs text-[var(--bb-text-muted)]">
                  {fileKind === 'audio' ? 'Audio' : 'Transcript'} &middot; {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); clearFile() }}
                className="ml-2 rounded p-1 text-[var(--bb-text-muted)] hover:bg-[var(--bb-border)] hover:text-[var(--bb-text-secondary)]"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="mb-2 size-8 text-[var(--bb-text-muted)]" />
              <p className="text-sm font-medium text-[var(--bb-text-primary)]">
                Drop file or click to browse
              </p>
              <p className="mt-1 text-xs text-[var(--bb-text-muted)]">
                VTT, TXT, SRT, MP3, WAV, M4A
              </p>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="h-full w-px bg-[var(--bb-border)]" />
          <span className="text-xs text-[var(--bb-text-muted)]">or</span>
          <div className="h-full w-px bg-[var(--bb-border)]" />
        </div>

        {/* Paste area */}
        <div className="flex-1">
          <textarea
            placeholder="Paste your meeting transcript here..."
            value={pastedText}
            onChange={(e) => {
              setPastedText(e.target.value)
              if (e.target.value.trim()) setFile(null)
            }}
            disabled={!!file}
            className="h-full w-full resize-none rounded-lg border border-[var(--bb-border)] bg-[var(--bb-page-bg)] p-3 text-sm text-[var(--bb-text-primary)] placeholder:text-[var(--bb-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--bb-accent)] disabled:opacity-50"
            style={{ minHeight: 180 }}
          />
        </div>
      </div>

      {/* Progress bar */}
      {status === 'analyzing' && (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bb-border)]">
            <div
              className="h-full rounded-full bg-[var(--bb-accent)] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-[var(--bb-text-muted)] text-center">{progressMessage}</p>
        </div>
      )}

      {/* Submit button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors',
            canSubmit
              ? 'bg-[var(--bb-accent)] hover:bg-[var(--bb-accent-hover)]'
              : 'bg-[var(--bb-text-muted)] cursor-not-allowed'
          )}
        >
          {isProcessing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {status === 'uploading' ? 'Uploading...' : 'Analyzing...'}
            </>
          ) : (
            <>
              <Zap className="size-4" />
              Analyze Meeting
            </>
          )}
        </button>
      </div>
    </div>
  )
}
