import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true
})

export function getApiErrorMessage(error, fallback = 'Something went wrong') {
  return error?.response?.data?.error || error?.message || fallback;
}

export function showApiErrorToast(toast, error, fallback, title = 'Error') {
  toast({
    title,
    description: getApiErrorMessage(error, fallback),
    variant: 'destructive',
  });
}
