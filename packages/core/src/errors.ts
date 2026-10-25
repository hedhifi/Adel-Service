export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(message = "That record was not found.") {
  return new AppError(404, message, "not_found");
}
