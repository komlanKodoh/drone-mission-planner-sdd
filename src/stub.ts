export function notImplemented(): never {
  const error = new Error("This contract is not implemented yet.");
  error.name = "NotImplementedError";
  throw error;
}
