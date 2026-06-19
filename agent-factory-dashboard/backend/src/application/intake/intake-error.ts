export class AgentFactoryError extends Error {
  public status: number;
  public error_code: string;
  public retryable: boolean;
  public target_id?: string;
  public operation_id?: string;
  public details?: Record<string, unknown>;

  constructor(
    message: string,
    error_code: string,
    status: number = 400,
    options: {
      retryable?: boolean;
      target_id?: string;
      operation_id?: string;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = 'AgentFactoryError';
    this.status = status;
    this.error_code = error_code;
    this.retryable = options.retryable !== false;
    this.target_id = options.target_id;
    this.operation_id = options.operation_id;
    this.details = options.details;
  }
}
