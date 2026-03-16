import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Upload, FileText, AudioLines, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, type AiOutput } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
}

type UploadStatus = 'idle' | 'uploading' | 'analyzing' | 'done'

export function UploadView({ onAnalysisComplete }: UploadViewProps) {
  const [file, setFile] = useState<File | null>(null)
  const [fileKind, setFileKind] = useState<FileKind>('transcript')
  const [pastedText, setPastedText] = useState('')
  const [provider, setProvider] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: providersData } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  })

  const providers = providersData?.providers ?? []
  const defaultProvider = providersData?.default ?? undefined

  const effectiveProvider = provider ?? defaultProvider

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
      const analysisResult = await api.analyze(meetingId, effectiveProvider)

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
    analyzing: `Analyzing with ${effectiveProvider ?? 'AI'}...`,
    done: 'Complete',
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Upload Meeting</h2>
        <p className="mt-1 text-sm text-slate-500">
          Upload a transcript or audio file, or paste text directly.
        </p>
      </div>

      {/* Drop zone */}
      <Card>
        <CardContent>
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
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 transition-colors',
              isDragOver
                ? 'border-blue-400 bg-blue-50'
                : file
                  ? 'border-slate-300 bg-slate-50'
                  : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/50'
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
                {fileKind === 'audio' ? (
                  <AudioLines className="size-8 text-blue-500" />
                ) : (
                  <FileText className="size-8 text-blue-500" />
                )}
                <div>
                  <p className="font-medium text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {fileKind === 'audio' ? 'Audio file' : 'Transcript file'} &middot;{' '}
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); clearFile() }}
                  className="ml-2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="mb-3 size-10 text-slate-400" />
                <p className="font-medium text-slate-700">
                  Drop a file here or click to browse
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Supports .vtt, .txt, .md, .srt, .mp3, .wav, .m4a, .webm
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          or paste transcript text below
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Paste area */}
      <Card>
        <CardContent>
          <Textarea
            placeholder="Paste your meeting transcript here..."
            value={pastedText}
            onChange={(e) => {
              setPastedText(e.target.value)
              if (e.target.value.trim()) setFile(null)
            }}
            className="min-h-32 resize-y"
            disabled={!!file}
          />
        </CardContent>
      </Card>

      {/* Provider + Submit */}
      <div className="flex items-end gap-4">
        {providers.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">AI Provider</label>
            <Select value={effectiveProvider} onValueChange={(v) => setProvider(v ?? undefined)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button
          size="lg"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="ml-auto gap-2 bg-blue-600 px-6 text-white hover:bg-blue-700"
        >
          {status !== 'idle' ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {statusLabel[status]}
            </>
          ) : (
            <>
              <Upload className="size-4" />
              Upload &amp; Analyze
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
