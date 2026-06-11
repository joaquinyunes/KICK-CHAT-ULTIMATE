interface ResponsePayload {
  success: boolean;
  data?: any;
  errors?: Record<string, string>;
}
