import { req } from './core';
import type { Comment } from './types/scans';

export const createComment = (scanId: string, vulnId: string, content: string) =>
  req<Comment>('POST', `/api/v1/scans/${scanId}/vulnerabilities/${vulnId}/comments`, { content });

export const updateComment = (commentId: string, content: string) =>
  req<Comment>('PUT', `/api/v1/comments/${commentId}`, { content });

export const deleteComment = (commentId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/comments/${commentId}`);