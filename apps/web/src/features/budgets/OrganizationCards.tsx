import { useRef, useState } from "react";

export function useOrganizationOrder(userId: string) {
  const key = `yeonieum-budget-order:${userId}`;
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(saved)
        ? [
            ...new Set(
              saved.filter((id): id is string => typeof id === "string"),
            ),
          ]
        : [];
    } catch {
      return [];
    }
  });
  const [message, setMessage] = useState("");
  function arrange<T extends { id: string }>(items: T[]) {
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...items].sort(
      (a, b) =>
        (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length),
    );
  }
  function move(ids: string[], from: string, to: string, name: string) {
    if (from === to || !ids.includes(from) || !ids.includes(to)) return;
    const next = ids.filter((id) => id !== from);
    next.splice(ids.indexOf(to), 0, from);
    const saved = [...next, ...order.filter((id) => !next.includes(id))];
    setOrder(saved);
    try {
      localStorage.setItem(key, JSON.stringify(saved));
      setMessage(`${name}을 ${next.indexOf(from) + 1}번째로 옮겼습니다.`);
    } catch {
      setMessage(
        `${name} 순서를 바꿨습니다. 브라우저 저장이 제한되어 이번 화면에서만 유지됩니다.`,
      );
    }
  }
  return { arrange, move, message };
}

type Card = {
  id: string;
  name: string;
  configured: boolean;
  budget: number;
  remaining: number;
  actual: number;
  count: number;
  settled: boolean;
};
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
export default function OrganizationCards({
  items,
  selected,
  onSelect,
  onMove,
  message,
}: {
  items: Card[];
  selected: string;
  onSelect: (id: string) => void;
  onMove: (ids: string[], from: string, to: string, name: string) => void;
  message: string;
}) {
  const dragging = useRef("");
  const [target, setTarget] = useState("");
  const [source, setSource] = useState("");
  function finish(to: string) {
    const from = dragging.current;
    onMove(
      items.map((i) => i.id),
      from,
      to,
      items.find((i) => i.id === from)?.name || "단체",
    );
    dragging.current = "";
    setSource("");
    setTarget("");
  }
  function hit(x: number, y: number) {
    return (
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-budget-org]")
        ?.dataset.budgetOrg || ""
    );
  }
  return (
    <>
      <p className="finance-order-hint" id="finance-order-help">
        카드를 드래그해 순서를 바꾸세요. 손잡이에 초점을 두고 방향키로도 옮길 수
        있습니다.
      </p>
      <div className="finance-org-grid" aria-label="단체별 예산 현황">
        {items.map((item, index) => (
          <div
            key={item.id}
            data-budget-org={item.id}
            className={`finance-org-card ${item.id === selected ? "is-selected" : ""} ${target === item.id ? "is-drop-target" : ""} ${source === item.id ? "is-dragging" : ""}`}
            draggable={items.length > 1}
            onDragStart={(e) => {
              dragging.current = item.id;
              setSource(item.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(
                "application/yeonieum-budget-org",
                item.id,
              );
            }}
            onDragOver={(e) => {
              if (dragging.current) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setTarget(item.id);
              }
            }}
            onDrop={(e) => {
              if (dragging.current) {
                e.preventDefault();
                finish(item.id);
              }
            }}
            onDragEnd={() => {
              dragging.current = "";
              setSource("");
              setTarget("");
            }}
          >
            <button
              type="button"
              className="finance-org-select"
              aria-pressed={item.id === selected}
              onClick={() => onSelect(item.id)}
            >
              <strong>{item.name}</strong>
              <span>
                {item.configured ? `연간 ${won(item.budget)}` : "예산 미설정"}
              </span>
              <b>
                {item.configured
                  ? `잔액 ${won(item.remaining)}`
                  : "연간 예산을 설정하세요"}
              </b>
              <small>
                {item.count}건 · 사용 {won(item.actual)}
                {item.settled ? " · 정산 확정" : ""}
              </small>
            </button>
            {items.length > 1 && (
              <button
                type="button"
                className="finance-order-handle"
                aria-label={`${item.name} 순서 변경`}
                aria-describedby="finance-order-help"
                title="드래그 또는 방향키로 이동"
                onKeyDown={(e) => {
                  const offset = ["ArrowLeft", "ArrowUp"].includes(e.key)
                    ? -1
                    : ["ArrowRight", "ArrowDown"].includes(e.key)
                      ? 1
                      : 0;
                  if (!offset) return;
                  e.preventDefault();
                  const to = items[index + offset];
                  if (to)
                    onMove(
                      items.map((i) => i.id),
                      item.id,
                      to.id,
                      item.name,
                    );
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  dragging.current = item.id;
                  setSource(item.id);
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (dragging.current) setTarget(hit(e.clientX, e.clientY));
                }}
                onPointerUp={(e) => {
                  if (dragging.current) {
                    finish(hit(e.clientX, e.clientY));
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                }}
                onPointerCancel={() => {
                  dragging.current = "";
                  setSource("");
                  setTarget("");
                }}
              >
                ⠿
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="finance-order-status" role="status">
        {message}
      </p>
    </>
  );
}
