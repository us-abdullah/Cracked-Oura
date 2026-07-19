import { useState } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

/**
 * One-click: export desktop snapshot + git push so Vercel phone site updates.
 */
export function UpdatePhoneButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.publishPhoneSite();
      const msg =
        r.message ||
        (r.pushed
          ? 'Phone site pushed. Wait ~1 min, then refresh on your phone.'
          : 'Phone site already up to date.');
      window.alert(msg);
    } catch (err: any) {
      window.alert(
        (err?.message || 'Update failed') +
          '\n\nOr double-click "Update Phone Site" on your Desktop / scripts\\Update-Phone-Site.bat'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={onClick}
      disabled={busy}
      title="Export data and push to Vercel phone site"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Smartphone className="h-4 w-4 mr-2" />
      )}
      {busy ? 'Updating…' : 'Update phone site'}
    </Button>
  );
}
