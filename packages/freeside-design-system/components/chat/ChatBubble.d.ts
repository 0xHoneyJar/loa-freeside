import * as React from 'react';

/** Concierge message bubble. `guest` = sunset/sunlight; `concierge` = raised + hairline; `system` = centered italic. */
export interface ChatBubbleProps extends React.HTMLAttributes<HTMLDivElement> {
  role?: 'guest' | 'concierge' | 'system';
  children?: React.ReactNode;
}

export function ChatBubble(props: ChatBubbleProps): JSX.Element;
