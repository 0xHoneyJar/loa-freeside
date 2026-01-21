import { apiClient } from './client';
import type { ComponentDefinition } from '@types';

interface ComponentsResponse {
  components: ComponentDefinition[];
  count: number;
}

interface ValidationResponse {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

export async function fetchComponents(): Promise<ComponentDefinition[]> {
  const response = await apiClient.get<ComponentsResponse>('/components');
  return response.components;
}

export async function fetchComponentByType(type: string): Promise<ComponentDefinition> {
  return apiClient.get<ComponentDefinition>(`/components/${type}`);
}

export async function validateComponentProps(
  type: string,
  props: Record<string, unknown>
): Promise<ValidationResponse> {
  return apiClient.post<ValidationResponse>(`/components/${type}/validate`, { props });
}
