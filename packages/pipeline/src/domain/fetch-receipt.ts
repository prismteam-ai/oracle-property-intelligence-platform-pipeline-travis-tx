export interface FetchReceipt {
  url: string;
  fetchedAt: string;
  httpStatus: number;
  bytes: number;
  sha256: string;
}
