import { useState, useCallback, useRef } from 'react'
import { Upload, FileText, AudioLines, Loader2, X, Sparkles, Zap, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileDrop = useCallback((files: FileList | null) => {
    if (!files?.length) return
    const droppedFile = files[0]
    const kind = detectFileKind(droppedFile)
    setFile(droppedFile)
    setFileKind(kind)
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

      setStatus('analyzing')
      const analysisResult = await api.analyze(meetingId, provider)

      setStatus('done')
      toast.success('Analysis complete')
      onAnalysisComplete(meetingId, analysisResult.ai_output)
    } catch (err) {
      setStatus('idle')
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const statusLabel: Record<UploadStatus, string> = {
    idle: '',
    uploading: 'Uploading file...',
    analyzing: `Analyzing with ${provider ?? 'AI'}...`,
    done: 'Complete',
  }

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary ring-1 ring-primary/20">
          <Sparkles className="size-4" />
          AI-Powered Meeting Intelligence
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
          Transform your meetings
          <br />
          <span className="text-gradient">into actionable insights</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Upload a transcript or audio file, and let AI extract decisions, action items, 
          and key insights from your conversations.
        </p>
      </div>

      {/* Drop zone */}
      <Card className="glass overflow-hidden border-border/50">
        <CardContent className="p-0">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              handleFileDrop(e.dataTransfer.files)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'relative flex cursor-pointer flex-col items-center justify-center px-8 py-16 transition-all duration-300',
              isDragOver && 'bg-primary/5',
              file && 'bg-card'
            )}
          >
            {/* Background pattern */}
            <div className="pointer-events-none absolute inset-0 opacity-[0.015]">
              <div className="h-full w-full" style={{
                backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
                backgroundSize: '24px 24px'
              }} />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={ALL_ACCEPT}
              className="hidden"
              onChange={(e) => handleFileDrop(e.target.files)}
            />

            {file ? (
              <div className="relative z-10 flex items-center gap-4 rounded-2xl bg-secondary/50 p-6 ring-1 ring-border">
                <div className={cn(
                  'flex size-14 items-center justify-center rounded-xl',
                  fileKind === 'audio' 
                    ? 'bg-chart-2/10 text-chart-2' 
                    : 'bg-primary/10 text-primary'
                )}>
                  {fileKind === 'audio' ? (
                    <AudioLines className="size-7" />
                  ) : (
                    <FileText className="size-7" />
                  )}
                </div>
                <div className="text-left">
                  <p className="font-semibold text-foreground">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {fileKind === 'audio' ? 'Audio file' : 'Transcript file'} &middot;{' '}
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); clearFile() }}
                  className="ml-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-5" />
                </button>
              </div>
            ) : (
              <div className="relative z-10 flex flex-col items-center">
                <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
                  <Upload className="size-9 text-primary" />
                </div>
                <p className="text-xl font-semibold text-foreground">
                  Drop your file here, or click to browse
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Supports VTT, TXT, MD, SRT, MP3, WAV, M4A, WEBM
                </p>
                <div className="mt-6 flex items-center gap-4">
                  {[
                    { icon: FileText, label: 'Transcripts' },
                    { icon: AudioLines, label: 'Audio' },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon className="size-4" />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          or paste text
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      {/* Paste area */}
      <Card className="glass border-border/50">
        <CardContent className="p-6">
          <Textarea
            placeholder="Paste your meeting transcript here..."
            value={pastedText}
            onChange={(e) => {
              setPastedText(e.target.value)
              if (e.target.value.trim()) setFile(null)
            }}
            className="min-h-36 resize-y border-border/50 bg-secondary/30 text-base placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-primary/20"
            disabled={!!file}
          />
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-end">
        <Button
          size="lg"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            'group gap-3 rounded-xl px-8 py-6 text-base font-semibold transition-all duration-300',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            canSubmit && 'glow-sm'
          )}
        >
          {status !== 'idle' ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              {statusLabel[status]}
            </>
          ) : (
            <>
              <Zap className="size-5" />
              Analyze Meeting
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </Button>
      </div>

      {/* Feature highlights */}
      <div className="grid gap-4 pt-4 md:grid-cols-3">
        {[
          {
            title: 'Decisions',
            description: 'Extract key decisions made during the meeting',
            color: 'text-chart-3',
            bg: 'bg-chart-3/10',
          },
          {
            title: 'Action Items',
            description: 'Identify tasks with owners and deadlines',
            color: 'text-primary',
            bg: 'bg-primary/10',
          },
          {
            title: 'Risks',
            description: 'Surface potential risks and blockers',
            color: 'text-chart-4',
            bg: 'bg-chart-4/10',
          },
        ].map((feature) => (
          <div
            key={feature.title}
            className="glass glass-hover rounded-xl border border-border/50 p-5"
          >
            <div className={cn('mb-3 inline-flex rounded-lg p-2', feature.bg)}>
              <Sparkles className={cn('size-5', feature.color)} />
            </div>
            <h3 className="font-semibold text-foreground">{feature.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
