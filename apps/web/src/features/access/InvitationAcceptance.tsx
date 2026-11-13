import { useState } from "react";
import { api } from "../../shared/api";
import Brand from "../../shared/Brand";
export default function InvitationAcceptance({ token }: { token: string }) {
  const [done, setDone] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function accept() {
    setBusy(true);
    setError("");
    try {
      await api("/invitations/accept", { token });
      history.replaceState(null, "", "/");
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setBusy(true);
    try {
      await api("/auth/logout", {});
      location.assign("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="invitation-page">
      <Brand />
      <span className="pill">LOCAL INVITATION PREVIEW</span>
      <h1>{done ? "초대 인증을 완료했습니다" : "연이음 초대 확인"}</h1>
      <p className="muted">
        개발용 초대·인증 시연입니다. 실제 이메일 수신이나 학적 확인을 의미하지
        않습니다.
      </p>
      {done ? (
        <>
          <p role="status">
            등록된 학번과 비밀번호로 로그인할 수 있습니다. 업무 권한은 담당자가
            별도로 부여합니다.
          </p>
          <button className="primary" disabled={busy} onClick={login}>
            로그인 화면으로
          </button>
        </>
      ) : (
        <>
          <p>이 링크는 발급 후 24시간 동안 한 번만 사용할 수 있습니다.</p>
          <button className="primary" disabled={busy} onClick={accept}>
            {busy ? "확인 중…" : "초대 인증 완료하기"}
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
