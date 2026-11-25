export default function Brand() {
  return (
    <span
      className="brand-logo"
      role="img"
      aria-label="연암공과대학교 심볼과 연이음 로고"
    >
      <img src="/brand/university-symbol.png" alt="" width="43" height="43" />
      <span className="brand-logo-copy">
        <strong className="brand-wordmark">연이음</strong>
        <small>학생자치 운영 포털</small>
      </span>
    </span>
  );
}
