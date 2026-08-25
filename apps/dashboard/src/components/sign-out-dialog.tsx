// AUREX SignOutDialog — adapted from shadcn-admin sign-out-dialog.tsx (MIT © 2024 Sat Naing)
// Cookie-session logout via API (no zustand auth store).
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSignOut: () => void | Promise<void>
}

export function SignOutDialog({ open, onOpenChange, onSignOut }: SignOutDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Sign out'
      desc='Are you sure you want to sign out? You will need to sign in again to access your account.'
      confirmText='Sign out'
      destructive
      handleConfirm={() => void onSignOut()}
      className='sm:max-w-sm'
    />
  )
}
