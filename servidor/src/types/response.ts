export interface GenericResponse {
  success: boolean;
  data?: any;
  errors?: Record<string, string>;
  [key: string]: any;
}
