import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { UploadView } from './UploadView'

interface UploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAnalysisComplete: (meetingId: string) => void
  provider?: string
}

export function UploadModal({ open, onOpenChange, onAnalysisComplete, provider }: UploadModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogTitle className="sr-only">Upload Meeting</DialogTitle>
        <DialogDescription className="sr-only">
          Upload a transcript or audio file for AI analysis
        </DialogDescription>
        <UploadView
          provider={provider}
          onAnalysisComplete={(meetingId) => {
            onAnalysisComplete(meetingId)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
