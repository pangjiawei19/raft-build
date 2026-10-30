export interface ContractRevision {
  contract: string;
  revision: number;
  sourceSha256: string;
}

export interface RevisionLedgerFile {
  contract?: string;
  ledger?: unknown[];
}

export function readContractRevision(options?: { ledgerPath?: string; sourcePath?: string }): Promise<ContractRevision>;

export function assertLedgerExtends(baseLedgerFile: RevisionLedgerFile, headLedgerFile: RevisionLedgerFile): void;
