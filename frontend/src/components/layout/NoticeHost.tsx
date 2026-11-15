import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { NOTICE_TEXT, SHELL_TEXT } from "@/lib/messages";
import { readState } from "@/lib/routes";

type NoticeCode = keyof typeof NOTICE_TEXT;

function isNoticeCode(value: string | undefined): value is NoticeCode {
  return value !== undefined && Object.prototype.hasOwnProperty.call(NOTICE_TEXT, value);
}

/**
 * Shows a notice carried in router state, such as the admin-role redirect (Requirement 1.7).
 * It stays until the user dismisses it, so it is visible for at least 5 seconds. The router
 * state is cleared, so a reload does not show it again.
 */
export function NoticeHost(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<NoticeCode | null>(null);
  const code = readState(location.state, "notice");

  useEffect(() => {
    if (!isNoticeCode(code)) return;
    setNotice(code);
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [code, location.pathname, location.search, navigate]);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start justify-between gap-3 rounded-md border border-status-info bg-status-info-bg p-3 text-status-info"
    >
      <p>
        <span className="font-medium">{SHELL_TEXT.noticeTitle}: </span>
        {NOTICE_TEXT[notice]}
      </p>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
        aria-label={SHELL_TEXT.dismiss}
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
