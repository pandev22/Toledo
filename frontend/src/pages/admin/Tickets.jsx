import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Pagination } from '@/components/Pagination';
import {
  MessageSquare,
  Eye,
  RefreshCw,
  Save,
  X,
  RotateCcw,
  MoreHorizontal,
  Download,
  ArrowUpIcon,
  ArrowDownIcon
} from 'lucide-react';
import axios from 'axios';

const StatsCard = ({ title, value, className }) => (
  <Card>
    <CardContent className="p-6">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <p className={`mt-2 text-3xl font-semibold ${className}`}>{value}</p>
    </CardContent>
  </Card>
);

const PriorityBadge = ({ priority }) => {
  const variants = {
    low: "bg-blue-500 text-white border-blue-400",
    medium: "bg-yellow-500 text-black border-yellow-400",
    high: "bg-orange-500 text-white border-orange-400",
    urgent: "bg-red-500 text-white border-red-400"
  };

  return (
    <Badge variant="outline" className={variants[priority]}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
};

const StatusBadge = ({ status }) => (
  <Badge 
    variant={status === 'open' ? 'success' : 'secondary'}
    className={status === 'open' ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-gray-500 text-white border-gray-400'}
  >
    {status.charAt(0).toUpperCase() + status.slice(1)}
  </Badge>
);

const ViewTicketDialog = ({ isOpen, onClose, ticketId, onStatusChange }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [replyContent, setReplyContent] = useState('');

  const { data: ticket } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async () => {
      const response = await fetch(`/api/tickets/${ticketId}`);
      if (!response.ok) throw new Error('Failed to fetch ticket');
      return response.json();
    },
    enabled: !!ticketId
  });

  const replyMutation = useMutation({
    mutationFn: async (content) => {
      const response = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (!response.ok) throw new Error('Failed to send reply');
      return response.json();
    },
    onSuccess: () => {
      setReplyContent('');
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      toast({
        title: "Success",
        description: "Reply sent successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send reply",
        variant: "destructive",
      });
    }
  });

  const handleSubmitReply = (e) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    replyMutation.mutate(replyContent);
  };

  if (!ticket) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl bg-[#1a1d21] border-[#2e3337]/50 text-white">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle className="text-white">{ticket.subject}</DialogTitle>
              <p className="text-sm text-[#95a1ad] mt-1">#{ticket.id.slice(0, 8)}</p>
            </div>
            <div className="flex gap-2">
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 max-h-[400px] overflow-y-auto">
          {ticket.messages.map((msg, idx) => (
            <div
              key={idx}
              className={`rounded-lg p-4 ${
                msg.isStaff 
                  ? 'bg-blue-600/20 border border-blue-500/30 ml-8' 
                  : msg.isSystem
                  ? 'bg-gray-600/20 border border-gray-500/30'
                  : 'bg-[#25282e] border border-[#3e4347] mr-8'
              }`}
            >
              <div className="flex justify-between items-start">
                <Badge 
                  variant="outline"
                  className={msg.isStaff 
                    ? 'bg-blue-500 text-white border-blue-400 font-medium' 
                    : msg.isSystem
                    ? 'bg-gray-500 text-white border-gray-400 font-medium'
                    : 'bg-[#4e5457] text-white border-[#5e6467] font-medium'
                  }
                >
                  {msg.isStaff ? 'Staff' : msg.isSystem ? 'System' : 'User'}
                </Badge>
                <span className="text-xs text-[#95a1ad]">
                  {new Date(msg.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-sm text-white">{msg.content}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-[#2e3337]/50 pt-4">
          <form onSubmit={handleSubmitReply} className="space-y-4">
            <Textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="Type your reply..."
              className="min-h-[100px] bg-[#202229] border-[#2e3337]/50 text-white placeholder:text-[#95a1ad]/50 resize-none"
            />
            <div className="flex justify-between">
              {ticket.status === 'open' ? (
                <ConfirmDialog
                  title="Close Ticket"
                  description="Are you sure you want to close this ticket?"
                  onConfirm={() => onStatusChange(ticket.id, 'closed')}
                  variant="destructive"
                  trigger={
                    <Button
                      type="button"
                      variant="destructive"
                      className="bg-red-500 hover:bg-red-600 text-white"
                    >
                      <X className="w-4 h-4 mr-2" /> Close Ticket
                    </Button>
                  }
                />
              ) : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => onStatusChange(ticket.id, 'open')}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white"
                >
                  <RotateCcw className="w-4 h-4 mr-2" /> Reopen Ticket
                </Button>
              )}
              <Button 
                type="submit" 
                disabled={replyMutation.isPending}
                className="bg-blue-500 hover:bg-blue-600 text-white"
              >
                {replyMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Send Reply
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const UpdatePriorityDialog = ({ isOpen, onClose, ticketId, onUpdate }) => {
  const [priority, setPriority] = useState('low');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Priority</DialogTitle>
        </DialogHeader>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger>
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onUpdate(ticketId, priority)}>Update</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default function AdminSupportDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    search: '',
    priority: 'all',
    category: 'all',
    status: 'all',
    sortBy: 'updated',
    sortOrder: 'desc'
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [priorityUpdateTicketId, setPriorityUpdateTicketId] = useState(null);
  const perPage = 10;

  const { data: stats } = useQuery({
    queryKey: ['ticket-stats'],
    queryFn: async () => {
      const response = await fetch('/api/tickets/stats');
      return response.json();
    }
  });

  const { data: ticketsData, refetch: refetchTickets } = useQuery({
    queryKey: ['tickets', currentPage, perPage, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        per_page: perPage.toString()
      });
      
      // Add filter params if set
      if (filters.priority !== 'all') params.append('priority', filters.priority);
      if (filters.category !== 'all') params.append('category', filters.category);
      if (filters.status !== 'all') params.append('status', filters.status);
      if (filters.search) params.append('query', filters.search);
      
      const response = await fetch(`/api/tickets/all?${params}`);
      return response.json();
    }
  });

  // Extract data and pagination info from response
  const tickets = ticketsData?.data || [];
  const pagination = ticketsData?.pagination || { page: 1, totalPages: 1, total: 0, hasNextPage: false, hasPrevPage: false };

  // Sort tickets
  const sortedTickets = Array.isArray(tickets) ? [...tickets].sort((a, b) => {
    let comparison = 0;
    
    switch (filters.sortBy) {
      case 'updated':
        comparison = new Date(b.updated) - new Date(a.updated);
        break;
      case 'created':
        comparison = new Date(b.created) - new Date(a.created);
        break;
      case 'priority':
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        comparison = priorityOrder[b.priority] - priorityOrder[a.priority];
        break;
      case 'subject':
        comparison = a.subject.localeCompare(b.subject);
        break;
      default:
        comparison = new Date(b.updated) - new Date(a.updated);
    }
    
    return filters.sortOrder === 'asc' ? -comparison : comparison;
  }) : [];

  const filteredTickets = sortedTickets;

  const statusMutation = useMutation({
    mutationFn: async ({ ticketId, status }) => {
      const response = await fetch(`/api/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error('Failed to update status');
      return response.json();
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-stats'] });
      toast({
        title: "Success",
        description: `Ticket ${status === 'closed' ? 'closed' : 'reopened'} successfully`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    }
  });

  const priorityMutation = useMutation({
    mutationFn: async ({ ticketId, priority }) => {
      const response = await fetch(`/api/tickets/${ticketId}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority })
      });
      if (!response.ok) throw new Error('Failed to update priority');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket'] });
      toast({
        title: "Success",
        description: "Priority updated successfully",
      });
      setPriorityUpdateTicketId(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update priority",
        variant: "destructive",
      });
    }
  });

  const handleStatusChange = (ticketId, status) => {
    statusMutation.mutate({ ticketId, status });
  };

  const handlePriorityUpdate = (ticketId, priority) => {
    priorityMutation.mutate({ ticketId, priority });
  };

  const exportTickets = async () => {
    try {
      const response = await fetch('/api/tickets/export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets-${new Date().toISOString()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting tickets:', error);
    }
  };

  return (
    <div className="space-y-6 p-6 bg-[#1a1d21] min-h-screen">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">Support Tickets</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Select
            value={filters.priority}
            onValueChange={(value) => setFilters(prev => ({ ...prev, priority: value }))}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.category}
            onValueChange={(value) => setFilters(prev => ({ ...prev, category: value }))}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="billing">Billing</SelectItem>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="abuse">Abuse</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.status}
            onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          <Input
            placeholder="Search tickets..."
            value={filters.search}
            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            className="w-full md:w-[200px]"
          />

          <Button onClick={exportTickets}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#2e3337]">
          <span className="text-sm text-gray-400">Sort by:</span>
          
          <Select
            value={filters.sortBy}
            onValueChange={(value) => setFilters(prev => ({ ...prev, sortBy: value }))}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Last Updated</SelectItem>
              <SelectItem value="created">Date Created</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="subject">Subject</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilters(prev => ({ 
              ...prev, 
              sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' 
            }))}
            className="flex items-center gap-2"
          >
            {filters.sortOrder === 'asc' ? (
              <><ArrowUpIcon className="w-4 h-4" /> Ascending</>
            ) : (
              <><ArrowDownIcon className="w-4 h-4" /> Descending</>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 md:grid-cols-2 gap-4">
        <StatsCard
          title="Total Tickets"
          value={stats?.total || '-'}
        />
        <StatsCard
          title="Open Tickets"
          value={stats?.open || '-'}
          className="text-emerald-400"
        />
        <StatsCard
          title="Avg. Response Time"
          value={stats?.averageResponseTime ? `${Math.round(stats.averageResponseTime / 60000)}m` : '-'}
          className="text-amber-400"
        />
        <StatsCard
          title="Last 7 Days"
          value={stats?.ticketsLastWeek || '-'}
          className="text-blue-400"
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2e3337]">
                <th className="text-left p-4 text-gray-300">Ticket</th>
                <th className="text-left p-4 text-gray-300">User</th>
                <th className="text-left p-4 text-gray-300">Category</th>
                <th className="text-left p-4 text-gray-300">Priority</th>
                <th className="text-left p-4 text-gray-300">Status</th>
                <th className="text-center p-4 text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map(ticket => (
                <tr key={ticket.id} className="border-b border-[#2e3337]">
                  <td className="p-4">
                    <div>
                      <div className="font-medium text-white">{ticket.subject}</div>
                      <div className="text-sm text-gray-400">#{ticket.id.slice(0, 8)}</div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm text-gray-200">{ticket.user.username}</div>
                    <div className="text-xs text-gray-400">{ticket.user.email}</div>
                  </td>
                  <td className="p-4">
                    <Badge variant="outline" className="bg-[#202229] text-[#95a1ad] border-[#2e3337]/50">
                      {ticket.category}
                    </Badge>
                  </td>
                  <td className="p-4">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  <td className="p-4">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="p-4">
                    <div className="flex justify-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedTicketId(ticket.id)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPriorityUpdateTicketId(ticket.id)}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                      {ticket.status === 'open' ? (
                        <ConfirmDialog
                          title="Close Ticket"
                          description="Are you sure you want to close this ticket?"
                          onConfirm={() => handleStatusChange(ticket.id, 'closed')}
                          variant="destructive"
                          trigger={
                            <Button variant="ghost" size="sm">
                              <X className="w-4 h-4 text-red-500" />
                            </Button>
                          }
                        />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStatusChange(ticket.id, 'open')}
                        >
                          <RotateCcw className="w-4 h-4 text-emerald-500" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          perPage={perPage}
          total={pagination.total}
          hasNextPage={pagination.hasNextPage}
          hasPrevPage={pagination.hasPrevPage}
          onPageChange={setCurrentPage}
        />
      </Card>

      {/* View Ticket Dialog */}
      <ViewTicketDialog
        isOpen={!!selectedTicketId}
        onClose={() => setSelectedTicketId(null)}
        ticketId={selectedTicketId}
        onStatusChange={handleStatusChange}
      />

      {/* Update Priority Dialog */}
      <UpdatePriorityDialog
        isOpen={!!priorityUpdateTicketId}
        onClose={() => setPriorityUpdateTicketId(null)}
        ticketId={priorityUpdateTicketId}
        onUpdate={handlePriorityUpdate}
      />
    </div>
  );
}
