const CORS_ORIGIN_ENV_NAME = 'VITE_ORIGIN_BASE_URL'

export function requiredCorsOrigin(value: string | undefined): string {
  const origin = value?.trim()

  if (!origin) {
    throw new Error(`${CORS_ORIGIN_ENV_NAME} is required; refusing to start with unrestricted CORS`)
  }

  return origin
}
