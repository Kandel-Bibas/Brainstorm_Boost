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
}

export function UploadModal({ open, onOpenChange, onAnalysisComplete }: UploadModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">Upload Meeting</DialogTitle>
        <DialogDescription className="sr-only">
          Upload a transcript or audio file for AI analysis
        </DialogDescription>
        <UploadView
          onAnalysisComplete={(meetingId) => {
            onAnalysisComplete(meetingId)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
