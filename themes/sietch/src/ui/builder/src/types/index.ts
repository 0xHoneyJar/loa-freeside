// Component types for the theme builder

export interface ComponentDefinition {
  type: string;
  name: string;
  description: string;
  category: 'web3' | 'content' | 'layout' | 'social';
  icon: string;
  defaultProps: Record<string, unknown>;
  schema: Record<string, unknown>;
}

export interface ComponentInstance {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: ComponentInstance[];
}

export interface PageLayout {
  id: string;
  name: string;
  slug: string;
  components: ComponentInstance[];
}

export interface ThemeBranding {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
  };
  fonts: {
    heading: { family: string; weight: number };
    body: { family: string; weight: number };
  };
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  spacing: 'compact' | 'comfortable' | 'spacious';
}

export interface Theme {
  id: string;
  name: string;
  description?: string;
  branding: ThemeBranding;
  pages: PageLayout[];
  createdAt: string;
  updatedAt: string;
}

export interface DragItem {
  type: 'new-component' | 'existing-component';
  componentType?: string;
  instanceId?: string;
}

export type ViewportSize = 'desktop' | 'tablet' | 'mobile';

export interface EditorState {
  activeThemeId: string | null;
  selectedComponentId: string | null;
  activePageId: string | null;
  viewport: ViewportSize;
  isDragging: boolean;
  isPreviewMode: boolean;
}
