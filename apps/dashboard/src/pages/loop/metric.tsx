// Ekstraksi verbatim dari pages/LoopPages.tsx (split §12-style, satu halaman per file).


export function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='font-medium tabular-nums'>{value}</p>
    </div>
  );
}
