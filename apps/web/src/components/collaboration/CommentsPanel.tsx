import { useState } from 'react';
import { Button } from '../ui/Button';
import {
  MessageSquare,
  Send,
  Reply,
  MoreVertical,
  Trash2,
  Edit2,
  Heart,
  CheckCircle,
  AlertCircle,
  Lightbulb,
  Flag,
  Pin,
  X
} from 'lucide-react';

interface Comment {
  id: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
    role: string;
  };
  content: string;
  timestamp: string;
  type: 'comment' | 'question' | 'suggestion' | 'concern';
  likes: number;
  isLiked: boolean;
  isPinned: boolean;
  replies: Comment[];
  isEdited: boolean;
}

interface CommentsPanelProps {
  darkMode: boolean;
  dealId: string;
  onClose?: () => void;
}

export function CommentsPanel({ darkMode, dealId, onClose }: CommentsPanelProps) {
  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState<'comment' | 'question' | 'suggestion' | 'concern'>('comment');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');

  // Mock comments data
  const [comments, setComments] = useState<Comment[]>([
    {
      id: '1',
      author: {
        id: '1',
        name: 'Sarah Chen',
        role: 'Owner'
      },
      content: 'The market opportunity looks very promising. Should we schedule a follow-up meeting with the founders?',
      timestamp: '2 hours ago',
      type: 'question',
      likes: 3,
      isLiked: false,
      isPinned: true,
      replies: [
        {
          id: '1-1',
          author: {
            id: '2',
            name: 'Michael Rodriguez',
            role: 'Admin'
          },
          content: 'Agreed! I can reach out to them this week. They mentioned availability on Thursday.',
          timestamp: '1 hour ago',
          type: 'comment',
          likes: 1,
          isLiked: true,
          isPinned: false,
          replies: [],
          isEdited: false
        }
      ],
      isEdited: false
    },
    {
      id: '2',
      author: {
        id: '3',
        name: 'Emily Watson',
        role: 'Editor'
      },
      content: 'I have some concerns about the competitive landscape. There are 3 well-funded competitors in this space.',
      timestamp: '3 hours ago',
      type: 'concern',
      likes: 2,
      isLiked: true,
      isPinned: false,
      replies: [],
      isEdited: false
    },
    {
      id: '3',
      author: {
        id: '4',
        name: 'David Kim',
        role: 'Viewer'
      },
      content: 'Suggestion: We should request their latest financial projections before proceeding with due diligence.',
      timestamp: '5 hours ago',
      type: 'suggestion',
      likes: 4,
      isLiked: false,
      isPinned: false,
      replies: [],
      isEdited: false
    }
  ]);

  const getTypeConfig = (type: string) => {
    switch (type) {
      case 'question':
        return { icon: MessageSquare, color: '#3b82f6', label: 'Question' };
      case 'suggestion':
        return { icon: Lightbulb, color: '#f59e0b', label: 'Suggestion' };
      case 'concern':
        return { icon: AlertCircle, color: '#ef4444', label: 'Concern' };
      default:
        return { icon: MessageSquare, color: '#6b7280', label: 'Comment' };
    }
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;

    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      author: {
        id: '1',
        name: 'Sarah Chen',
        role: 'Owner'
      },
      content: newComment,
      timestamp: 'Just now',
      type: commentType,
      likes: 0,
      isLiked: false,
      isPinned: false,
      replies: [],
      isEdited: false
    };

    setComments([comment, ...comments]);
    setNewComment('');
  };

  const handleAddReply = (commentId: string) => {
    if (!replyContent.trim()) return;

    const reply: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      author: {
        id: '1',
        name: 'Sarah Chen',
        role: 'Owner'
      },
      content: replyContent,
      timestamp: 'Just now',
      type: 'comment',
      likes: 0,
      isLiked: false,
      isPinned: false,
      replies: [],
      isEdited: false
    };

    setComments(comments.map(comment => {
      if (comment.id === commentId) {
        return {
          ...comment,
          replies: [...comment.replies, reply]
        };
      }
      return comment;
    }));

    setReplyContent('');
    setReplyingTo(null);
  };

  const handleLike = (commentId: string, isReply: boolean = false, parentId?: string) => {
    if (isReply && parentId) {
      setComments(comments.map(comment => {
        if (comment.id === parentId) {
          return {
            ...comment,
            replies: comment.replies.map(reply => {
              if (reply.id === commentId) {
                return {
                  ...reply,
                  likes: reply.isLiked ? reply.likes - 1 : reply.likes + 1,
                  isLiked: !reply.isLiked
                };
              }
              return reply;
            })
          };
        }
        return comment;
      }));
    } else {
      setComments(comments.map(comment => {
        if (comment.id === commentId) {
          return {
            ...comment,
            likes: comment.isLiked ? comment.likes - 1 : comment.likes + 1,
            isLiked: !comment.isLiked
          };
        }
        return comment;
      }));
    }
  };

  const handlePin = (commentId: string) => {
    setComments(comments.map(comment => {
      if (comment.id === commentId) {
        return { ...comment, isPinned: !comment.isPinned };
      }
      return comment;
    }));
  };

  const handleDelete = (commentId: string) => {
    setComments(comments.filter(comment => comment.id !== commentId));
  };

  const renderComment = (comment: Comment, isReply: boolean = false, parentId?: string) => {
    const typeConfig = getTypeConfig(comment.type);
    const TypeIcon = typeConfig.icon;

    return (
      <div
        key={comment.id}
        className={`${isReply ? 'ml-12' : ''} ${
          isReply ? 'mt-3' : ''
        }`}
      >
        <div className={`p-4 rounded-xl border transition-colors ${
          comment.isPinned
            ? darkMode
              ? 'bg-[#6366f1]/5 border-[#6366f1]/20'
              : 'bg-[#6366f1]/5 border-[#6366f1]/20'
            : darkMode
              ? 'bg-[#18181b] border-white/10 hover:border-white/20'
              : 'bg-white border-gray-200 hover:border-gray-300'
        }`}>
          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-start gap-3 flex-1">
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${
                darkMode ? 'bg-[#6366f1]/20 text-[#6366f1]' : 'bg-[#6366f1]/10 text-[#6366f1]'
              }`}>
                {comment.author.name.split(' ').map(n => n[0]).join('')}
              </div>

              {/* Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {comment.author.name}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    darkMode ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {comment.author.role}
                  </span>
                  {comment.isPinned && (
                    <Pin className="w-3 h-3 text-[#6366f1]" />
                  )}
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    {comment.timestamp}
                  </span>
                  {comment.isEdited && (
                    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      (edited)
                    </span>
                  )}
                </div>

                {/* Type Badge */}
                {comment.type !== 'comment' && (
                  <div 
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs mb-2"
                    style={{ 
                      backgroundColor: typeConfig.color + '20',
                      color: typeConfig.color
                    }}
                  >
                    <TypeIcon className="w-3 h-3" />
                    {typeConfig.label}
                  </div>
                )}

                {/* Content */}
                <div className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {comment.content}
                </div>
              </div>
            </div>

            {/* Actions Menu */}
            <button
              className={`p-1 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <MoreVertical className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </button>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t ${
            darkMode ? 'border-white/10' : 'border-gray-200'
          }">
            <button
              onClick={() => handleLike(comment.id, isReply, parentId)}
              className={`flex items-center gap-1 text-xs transition-colors ${
                comment.isLiked
                  ? 'text-[#ef4444]'
                  : darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-700'
              }`}
            >
              <Heart className={`w-4 h-4 ${comment.isLiked ? 'fill-current' : ''}`} />
              {comment.likes > 0 && comment.likes}
            </button>

            {!isReply && (
              <button
                onClick={() => setReplyingTo(comment.id)}
                className={`flex items-center gap-1 text-xs transition-colors ${
                  darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-700'
                }`}
              >
                <Reply className="w-4 h-4" />
                Reply
              </button>
            )}

            {!isReply && (
              <button
                onClick={() => handlePin(comment.id)}
                className={`flex items-center gap-1 text-xs transition-colors ${
                  comment.isPinned
                    ? 'text-[#6366f1]'
                    : darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-700'
                }`}
              >
                <Pin className="w-4 h-4" />
                {comment.isPinned ? 'Pinned' : 'Pin'}
              </button>
            )}

            <button
              onClick={() => handleDelete(comment.id)}
              className={`flex items-center gap-1 text-xs transition-colors ${
                darkMode ? 'text-gray-400 hover:text-red-400' : 'text-gray-600 hover:text-red-600'
              }`}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>

        {/* Reply Input */}
        {replyingTo === comment.id && (
          <div className={`ml-12 mt-3 p-3 rounded-lg border ${
            darkMode ? 'bg-[#18181b] border-white/10' : 'bg-gray-50 border-gray-200'
          }`}>
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="Write a reply..."
              rows={2}
              className={`w-full px-3 py-2 rounded-lg border resize-none text-sm mb-2 ${
                darkMode
                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                darkMode={darkMode}
                onClick={() => {
                  setReplyingTo(null);
                  setReplyContent('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                darkMode={darkMode}
                onClick={() => handleAddReply(comment.id)}
                disabled={!replyContent.trim()}
                icon={<Send className="w-4 h-4" />}
              >
                Reply
              </Button>
            </div>
          </div>
        )}

        {/* Replies */}
        {comment.replies.length > 0 && (
          <div className="mt-3 space-y-3">
            {comment.replies.map(reply => renderComment(reply, true, comment.id))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`h-full flex flex-col ${darkMode ? 'bg-[#0a0a0b]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`border-b px-6 py-4 ${
        darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-xl ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Discussion
            </h2>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {comments.length} comments • {comments.reduce((acc, c) => acc + c.replies.length, 0)} replies
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
              }`}
            >
              <X className={`w-5 h-5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`} />
            </button>
          )}
        </div>
      </div>

      {/* New Comment Input */}
      <div className={`border-b p-6 ${
        darkMode ? 'bg-[#18181b] border-white/10' : 'bg-white border-gray-200'
      }`}>
        <div className="mb-3">
          <div className="flex gap-2 mb-3">
            {[
              { type: 'comment', label: 'Comment', icon: MessageSquare },
              { type: 'question', label: 'Question', icon: MessageSquare },
              { type: 'suggestion', label: 'Suggestion', icon: Lightbulb },
              { type: 'concern', label: 'Concern', icon: AlertCircle }
            ].map(option => {
              const Icon = option.icon;
              return (
                <button
                  key={option.type}
                  onClick={() => setCommentType(option.type as any)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-all ${
                    commentType === option.type
                      ? darkMode
                        ? 'bg-[#6366f1]/20 border border-[#6366f1] text-[#6366f1]'
                        : 'bg-[#6366f1]/10 border border-[#6366f1] text-[#6366f1]'
                      : darkMode
                        ? 'bg-white/5 border border-white/10 text-gray-400 hover:border-white/20'
                        : 'bg-gray-50 border border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={`Add a ${commentType}...`}
            rows={3}
            className={`w-full px-4 py-3 rounded-lg border resize-none text-sm ${
              darkMode
                ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
        </div>

        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            darkMode={darkMode}
            onClick={handleAddComment}
            disabled={!newComment.trim()}
            icon={<Send className="w-4 h-4" />}
          >
            Post {commentType === 'comment' ? 'Comment' : commentType.charAt(0).toUpperCase() + commentType.slice(1)}
          </Button>
        </div>
      </div>

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {comments
            .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0))
            .map(comment => renderComment(comment))}

          {comments.length === 0 && (
            <div className={`text-center py-12 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No comments yet</p>
              <p className="text-xs mt-1">Start the discussion above</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
