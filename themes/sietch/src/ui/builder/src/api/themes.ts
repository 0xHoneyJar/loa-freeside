import { apiClient } from './client';
import type { Theme, PageLayout } from '@types';

interface ThemesListResponse {
  themes: Theme[];
  count: number;
}

interface ThemeResponse {
  theme: Theme;
}

interface PreviewResponse {
  html: string;
}

// Theme CRUD
export async function fetchThemes(): Promise<Theme[]> {
  const response = await apiClient.get<ThemesListResponse>('/themes');
  return response.themes;
}

export async function fetchTheme(id: string): Promise<Theme> {
  const response = await apiClient.get<ThemeResponse>(`/themes/${id}`);
  return response.theme;
}

export async function createTheme(data: Partial<Theme>): Promise<Theme> {
  const response = await apiClient.post<ThemeResponse>('/themes', data);
  return response.theme;
}

export async function updateTheme(id: string, data: Partial<Theme>): Promise<Theme> {
  const response = await apiClient.patch<ThemeResponse>(`/themes/${id}`, data);
  return response.theme;
}

export async function deleteTheme(id: string): Promise<void> {
  await apiClient.delete(`/themes/${id}`);
}

// Page management
export async function addPageToTheme(
  themeId: string,
  page: Omit<PageLayout, 'id'>
): Promise<PageLayout> {
  const response = await apiClient.post<{ page: PageLayout }>(
    `/themes/${themeId}/pages`,
    page
  );
  return response.page;
}

export async function updatePage(
  themeId: string,
  pageId: string,
  data: Partial<PageLayout>
): Promise<PageLayout> {
  const response = await apiClient.patch<{ page: PageLayout }>(
    `/themes/${themeId}/pages/${pageId}`,
    data
  );
  return response.page;
}

export async function deletePage(themeId: string, pageId: string): Promise<void> {
  await apiClient.delete(`/themes/${themeId}/pages/${pageId}`);
}

// Preview
export async function generatePreview(
  themeId: string,
  pageId: string,
  viewport?: 'desktop' | 'tablet' | 'mobile'
): Promise<string> {
  const query = viewport ? `?viewport=${viewport}` : '';
  const response = await apiClient.get<PreviewResponse>(
    `/themes/${themeId}/pages/${pageId}/preview${query}`
  );
  return response.html;
}
