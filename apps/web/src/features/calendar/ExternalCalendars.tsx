import { useEffect, useRef, useState } from "react";
import { api, type CalendarEvent } from "./api";
export type ExternalSource = {
  id: string;
  name: string;
  source_url: string;
  enabled: boolean;
  configured: boolean;
  buckets: {
    bucket: string;
    last_success: string | null;
    last_error: string;
    item_count: number;
  }[];
};
type Response = {
  events: CalendarEvent[];
  sources: ExternalSource[];
  can_refresh: boolean;
};
export function useExternalCalendars(
  query: string,
  reload: number,
  keepOverlap = false,
) {
  const request = useRef(0),
    lastQuery = useRef("");
  const [data, setData] = useState<Response>({
    events: [],
    sources: [],
    can_refresh: false,
  });
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 300000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const current = ++request.current;
    if (lastQuery.current !== query && !keepOverlap)
      setData({ events: [], sources: [], can_refresh: false });
    lastQuery.current = query;
    setError("");
    setLoading(true);
    api<Response>(`/calendar/external?${query}`)
      .then((next) => {
        if (current === request.current) setData(next);
      })
      .catch(() => {
        if (current === request.current)
          setError(
            "공식 일정 연결 상태를 확인하지 못했습니다. 마지막 화면 자료를 유지합니다.",
          );
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
    return () => {
      if (current === request.current) ++request.current;
    };
  }, [query, reload, tick, keepOverlap]);
  async function refresh() {
    const current = ++request.current;
    setLoading(true);
    setError("");
    try {
      const next = await api<Response>(
        `/calendar/external/refresh?${query}`,
        {},
      );
      if (current === request.current) setData(next);
    } catch {
      if (current === request.current)
        setError(
          "공식 일정 갱신을 요청하지 못했습니다. 마지막 화면 자료를 유지합니다.",
        );
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  return { ...data, error, loading, refresh };
}
export function ExternalSources({
  sources,
  hidden,
  onToggle,
  loading,
  error,
  canRefresh,
  onRefresh,
}: {
  sources: ExternalSource[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  loading: boolean;
  error: string;
  canRefresh: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="cal-external-sources" aria-label="공식 일정 연동">
      <h3>공식 일정</h3>
      {loading && <small role="status">공식 일정을 확인하고 있습니다…</small>}
      {error && <small role="status">{error}</small>}
      {sources.map((source) => {
        const checked = source.buckets.filter((b) => b.last_success),
          oldest = checked.map((b) => b.last_success!).sort()[0];
        return (
          <div key={source.id}>
            <label className="calendar-check">
              <input
                type="checkbox"
                checked={!hidden.has(source.id)}
                onChange={() => onToggle(source.id)}
              />
              <i
                className={`calendar-dot cal-external-dot-${source.id}`}
                aria-hidden="true"
              />
              {source.name}
            </label>
            <small>
              {!source.enabled
                ? "자동 연동 꺼짐"
                : !source.configured
                  ? "공휴일 API 인증키 설정 필요"
                  : source.buckets.some((b) => b.last_error)
                    ? "갱신 지연 · 마지막 자료 유지"
                    : checked.length !== source.buckets.length
                      ? "일부 기간 확인 대기"
                      : "자동 갱신 중"}
            </small>
            {oldest && (
              <small>
                최근 확인{" "}
                {new Intl.DateTimeFormat("ko-KR", {
                  timeZone: "Asia/Seoul",
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(oldest))}
              </small>
            )}
            <a
              href={source.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              공식 출처 ↗
            </a>
          </div>
        );
      })}
      {canRefresh && (
        <button
          type="button"
          className="cal-inline-action"
          disabled={loading}
          onClick={onRefresh}
        >
          공식 일정 새로 확인
        </button>
      )}
    </section>
  );
}
export function ExternalEventDetail({
  event,
  onClose,
}: {
  event: CalendarEvent;
  onClose: () => void;
}) {
  const date = (value: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(value));
  return (
    <section className="cal-external-detail" aria-label="공식 일정 상세">
      <p className="cal-external-badge">{event.org_name} · 자동 연동</p>
      <h2>{event.title}</h2>
      <p>
        {date(event.starts_at)} ~{" "}
        {date(new Date(Date.parse(event.ends_at) - 1).toISOString())} · 종일
      </p>
      <p>
        공식 출처에서 가져온 읽기 전용 일정입니다. 원본의 변경 사항은 다음 갱신
        때 반영됩니다.
      </p>
      <a href={event.source_url} target="_blank" rel="noopener noreferrer">
        공식 원본 확인 ↗
      </a>
      <button type="button" onClick={onClose}>
        기본 안내로 돌아가기
      </button>
    </section>
  );
}
