import { useEffect, useState } from "react";
import { api, type Workspace } from "../../shared/api";
type Message = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  link: string;
  expires_at: string;
};
type Props = { workspace: Workspace; onChanged: () => Promise<void> };
export default function InvitationOutbox({ workspace, onChanged }: Props) {
  const [messages, setMessages] = useState<Message[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ messages: Message[] }>("/invitations/outbox")
      .then((data) => {
        if (live) setMessages(data.messages);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [workspace]);
  async function resend(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/users/${id}/invite`, {});
      await onChanged();
      setNotice(
        "로컬 초대 링크를 재발급했습니다. 이전 링크는 사용할 수 없습니다.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel local-outbox">
      <h2>로컬 초대 수신함</h2>
      <p className="muted">
        개발용 수신함입니다. 실제 이메일을 발송하거나 주소의 실존 여부를
        검증하지 않습니다. 링크로 24시간 이내에 1회 초대 인증을 시연할 수
        있습니다.
      </p>
      {messages.map((m) => (
        <article key={m.id} className="outbox-message">
          <div>
            <strong>{m.name}</strong>
            <p>{m.email}</p>
            <small>
              만료: {new Date(m.expires_at).toLocaleString("ko-KR")}
            </small>
          </div>
          <a href={m.link} target="_blank" rel="noopener noreferrer">
            초대 확인 열기
          </a>
        </article>
      ))}
      {!messages.length && (
        <p className="muted">현재 확인할 수 있는 로컬 초대가 없습니다.</p>
      )}
      <div className="pending-invites">
        {workspace.users
          .filter((p) => p.email_verified === 0)
          .map((p) => (
            <div key={p.id}>
              <span>{p.name} · 초대 인증 대기</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => resend(p.id)}
                aria-label={`${p.name} 초대 재발급`}
              >
                초대 재발급
              </button>
            </div>
          ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
    </section>
  );
}
