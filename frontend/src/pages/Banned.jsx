import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AlertTriangle, ShieldAlert, LogOut, Home, RefreshCw } from 'lucide-react';

import { useSettings } from '../hooks/useSettings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

function formatBanDate(value) {
  if (!value) {
    return 'Unknown date';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

export default function BannedPage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [banState, setBanState] = useState(null);

  useEffect(() => {
    const loadState = async () => {
      try {
        const response = await fetch('/api/v5/state', {
          credentials: 'include',
        });

        if (response.status === 401) {
          navigate('/auth', { replace: true });
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to load ban state');
        }

        const data = await response.json();
        if (!data.banned) {
          navigate('/dashboard', { replace: true });
          return;
        }

        setBanState(data.ban);
      } catch (error) {
        console.error('Failed to load banned state:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadState();
  }, [navigate]);

  const banDate = useMemo(() => formatBanDate(banState?.bannedAt), [banState?.bannedAt]);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await axios.post('/api/user/logout');
    } catch (error) {
      console.error('Failed to logout from banned page:', error);
    } finally {
      window.location.href = '/auth';
    }
  };

  return (
    <div className="min-h-screen bg-[#101218] text-white flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border border-[#2e3337] bg-[#171a21] text-white shadow-2xl">
        <CardHeader className="space-y-4 border-b border-white/5 pb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Badge variant="destructive" className="gap-2 bg-red-500/90 text-white">
              <ShieldAlert className="h-3.5 w-3.5" />
              Access blocked
            </Badge>
            <div className="text-sm text-[#95a1ad]">{settings?.name || 'Heliactyl'}</div>
          </div>
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-red-500/10 p-3 border border-red-500/20">
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl">This account has been banned</CardTitle>
              <CardDescription className="text-base text-[#95a1ad]">
                You can still access authentication and logout, but the dashboard and protected requests are blocked.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {isLoading ? (
            <div className="flex items-center gap-3 text-[#95a1ad]">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading your ban details...
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-white/5 bg-[#11141a] p-4">
                  <div className="text-sm text-[#95a1ad] mb-2">Reason</div>
                  <div className="text-sm leading-6 text-white whitespace-pre-wrap">
                    {banState?.reason || 'No reason provided.'}
                  </div>
                </div>

                <div className="rounded-xl border border-white/5 bg-[#11141a] p-4 space-y-4">
                  <div>
                    <div className="text-sm text-[#95a1ad] mb-2">Staff member</div>
                    <div className="text-sm text-white">{banState?.staff?.username || 'Unknown staff member'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-[#95a1ad] mb-2">Ban date</div>
                    <div className="text-sm text-white">{banDate}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                If you think this is a mistake, contact the staff team and mention the account username shown on your login session.
              </div>
            </>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="text-black" onClick={() => window.location.href = '/'}>
              <Home className="mr-2 h-4 w-4" />
              Back to website
            </Button>
            <Button variant="destructive" onClick={handleLogout} disabled={isLoggingOut}>
              <LogOut className="mr-2 h-4 w-4" />
              {isLoggingOut ? 'Logging out...' : 'Logout'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
