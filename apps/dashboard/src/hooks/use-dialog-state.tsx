import { useState } from 'react'

/**
 * Custom hook for confirm dialog
 * @param initialState string | boolean
 * @returns A stateful value, and a function to update it.
 * @example const [open, setOpen] = useDialogState<"approve" | "reject">()
 */
export default function useDialogState<T extends string | boolean>(
  initialState: T | null = null
) {
  const [open, _setOpen] = useState<T | null>(initialState)

  // Dialog onOpenChange contract: boolean | null (null = dismiss).
  const setOpen = (value: T | boolean | null) => {
    if (value === null || value === undefined) {
      _setOpen(null)
      return
    }
    _setOpen((prev) => (prev === value ? null : (value as T)))
  }

  // Toggle-style open (used by menu triggers: setOpen(true) from closed).
  const openDialog = (value: T) => _setOpen(value)

  return [open, setOpen, openDialog] as const
}
