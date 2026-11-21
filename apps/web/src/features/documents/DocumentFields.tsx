import type { LibraryMetadata, LibraryOption } from "./api";

export default function DocumentFields({
  value,
  onChange,
  units,
  lockScope = false,
}: {
  value: LibraryMetadata;
  onChange: (value: LibraryMetadata) => void;
  units: LibraryOption[];
  lockScope?: boolean;
}) {
  function set<K extends keyof LibraryMetadata>(
    key: K,
    next: LibraryMetadata[K],
  ) {
    onChange({ ...value, [key]: next });
  }
  const selected = units.find((u) => u.id === value.unit_id);
  return (
    <>
      <label>
        보관할 담당 범위
        <select
          required
          disabled={lockScope}
          value={value.unit_id}
          onChange={(e) => onChange({ ...value, unit_id: e.target.value })}
        >
          <option value="">범위 선택</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        자료 제목
        <input
          required
          maxLength={150}
          value={value.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </label>
      <div className="library-field-grid">
        <label>
          학년도
          <input
            type="number"
            required
            disabled={Boolean(value.folder_id)}
            min={1900}
            max={2200}
            value={value.academic_year}
            onChange={(e) => set("academic_year", Number(e.target.value))}
          />
        </label>
        <label>
          자료 종류
          <input
            required
            maxLength={60}
            placeholder="예: 회의록, 행사 보고서"
            value={value.category}
            onChange={(e) => set("category", e.target.value)}
          />
        </label>
        <label>
          분류 태그 (기존 폴더 분류)
          <input
            maxLength={120}
            placeholder="예: 정기 회의"
            value={value.folder}
            onChange={(e) => set("folder", e.target.value)}
          />
        </label>
        <label>
          행사명
          <input
            maxLength={120}
            value={value.event}
            onChange={(e) => set("event", e.target.value)}
          />
        </label>
      </div>
      <label>
        설명
        <textarea
          maxLength={2000}
          rows={3}
          value={value.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <label>
        열람 대상
        <select
          disabled={Boolean(value.folder_id)}
          value={value.audience}
          onChange={(e) => set("audience", e.target.value)}
        >
          {(
            selected?.audiences || [
              {
                key: value.audience,
                label:
                  value.audience === "unit" ? "해당 담당 범위" : value.audience,
              },
            ]
          ).map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {value.folder_id && (
        <p className="form-note">
          이 파일은 선택한 폴더의 연도와 공유 방식을 따릅니다.
        </p>
      )}
    </>
  );
}
