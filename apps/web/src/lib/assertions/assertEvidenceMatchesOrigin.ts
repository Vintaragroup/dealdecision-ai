export type EvidenceOrigin = 'deterministic' | 'overlay';

export type EvidencePointer = {
  origin: EvidenceOrigin;
  kind: 'ref' | 'id';
  id?: string;
};

export type OriginTaggedField = {
  fieldKey: string;
  chosenOrigin: EvidenceOrigin | 'missing';
  evidence: EvidencePointer[];
};

export function assertEvidenceMatchesOrigin(fields: OriginTaggedField[]): void {
  if (!import.meta.env.DEV) return;

  for (const f of fields) {
    if (!f || typeof f !== 'object') continue;
    if (f.chosenOrigin === 'missing') continue;

    for (const e of Array.isArray(f.evidence) ? f.evidence : []) {
      if (!e || typeof e !== 'object') continue;
      if (e.origin !== f.chosenOrigin) {
        throw new Error(
          `[DDAI][evidence-origin] Field '${f.fieldKey}' selected '${f.chosenOrigin}' but contains '${e.origin}' evidence.`
        );
      }
    }
  }
}
