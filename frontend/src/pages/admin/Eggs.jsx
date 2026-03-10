import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  RefreshCw,
  Egg,
  Settings2,
  MoreVertical,
  Check,
  X,
  Download,
  FolderOpen,
  Plus,
  Trash2,
  Edit,
  Search,
  Filter,
  AlertCircle,
  Cpu,
  HardDrive,
  MemoryStick,
  Layers
} from 'lucide-react';
import axios from 'axios';
import { useToast } from '@/hooks/use-toast';

import { ConfirmDialog } from '@/components/ConfirmDialog';
export default function AdminEggs() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedEgg, setSelectedEgg] = useState(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [newCategory, setNewCategory] = useState({ id: '', name: '', icon: 'folder' });
  const [isSyncing, setIsSyncing] = useState(false);

  // Fetch eggs and categories
  const { data: eggsData, isLoading, error } = useQuery({
    queryKey: ['admin-eggs'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/eggs');
      return data;
    }
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      setIsSyncing(true);
      const { data } = await axios.post('/api/admin/eggs/sync');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(['admin-eggs']);
      toast({
        title: "Sync Complete",
        description: `Synced ${data.syncedCount} eggs (${data.newCount} new)`,
      });
      setIsSyncing(false);
    },
    onError: (error) => {
      toast({
        title: "Sync Failed",
        description: error.response?.data?.error || "Failed to sync eggs",
        variant: "destructive"
      });
      setIsSyncing(false);
    }
  });

  // Toggle egg mutation
  const toggleMutation = useMutation({
    mutationFn: async (eggId) => {
      const { data } = await axios.patch(`/api/admin/eggs/${eggId}/toggle`);
      return { eggId, enabled: data.enabled };
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-eggs']);
    },
    onError: (error) => {
      toast({
        title: "Toggle Failed",
        description: error.response?.data?.error || "Failed to toggle egg",
        variant: "destructive"
      });
    }
  });

  // Update egg mutation
  const updateMutation = useMutation({
    mutationFn: async ({ eggId, updates }) => {
      const { data } = await axios.patch(`/api/admin/eggs/${eggId}`, updates);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-eggs']);
      setIsEditDialogOpen(false);
      toast({
        title: "Egg Updated",
        description: "Egg configuration saved successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.response?.data?.error || "Failed to update egg",
        variant: "destructive"
      });
    }
  });

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: async (category) => {
      const { data } = await axios.post('/api/admin/eggs/categories', category);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-eggs']);
      setIsCategoryDialogOpen(false);
      setNewCategory({ id: '', name: '', icon: 'folder' });
      toast({
        title: "Category Created",
        description: "New category added successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Creation Failed",
        description: error.response?.data?.error || "Failed to create category",
        variant: "destructive"
      });
    }
  });

  // Filter eggs
  const filteredEggs = React.useMemo(() => {
    if (!eggsData?.eggs) return [];
    
    return Object.entries(eggsData.eggs).filter(([id, egg]) => {
      const matchesSearch = searchQuery === '' || 
        egg.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        egg.originalName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        egg.nestName?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = categoryFilter === 'all' || egg.category === categoryFilter;
      
      return matchesSearch && matchesCategory;
    });
  }, [eggsData?.eggs, searchQuery, categoryFilter]);

  // Stats
  const stats = React.useMemo(() => {
    if (!eggsData?.eggs) return { total: 0, enabled: 0, disabled: 0 };
    const eggs = Object.values(eggsData.eggs);
    return {
      total: eggs.length,
      enabled: eggs.filter(e => e.enabled).length,
      disabled: eggs.filter(e => !e.enabled).length
    };
  }, [eggsData?.eggs]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="h-8 w-32 bg-neutral-800 rounded animate-pulse mb-6" />
        <div className="grid gap-6">
          <div className="h-40 bg-neutral-800 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load eggs: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Egg Management</h1>
            <p className="text-neutral-400 text-sm mt-1">
              Sync and configure server eggs from your Pterodactyl panel
              {eggsData?.lastSync && (
                <span className="text-neutral-500 ml-2">
                  · Last synced {new Date(eggsData.lastSync).toLocaleString()}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setIsCategoryDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              New Category
            </Button>
            <ConfirmDialog
              title="Sync Eggs from Panel?"
              description="This will fetch all eggs from your Pterodactyl panel. New eggs will be added and existing ones will be updated."
              confirmText="Sync Now"
              onConfirm={() => syncMutation.mutate()}
              trigger={
                <Button disabled={isSyncing}>
                  {isSyncing ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Sync from Panel
                    </>
                  )}
                </Button>
              }
            />
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#202229] rounded-lg">
                  <Egg className="w-6 h-6 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-400">Total Eggs</p>
                  <p className="text-2xl font-bold text-white">{stats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/10 rounded-lg">
                  <Check className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-400">Enabled</p>
                  <p className="text-2xl font-bold text-white">{stats.enabled}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <X className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-400">Disabled</p>
                  <p className="text-2xl font-bold text-white">{stats.disabled}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#202229] rounded-lg">
                  <Layers className="w-6 h-6 text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-400">Categories</p>
                  <p className="text-2xl font-bold text-white">{eggsData?.categories?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <Input
                  placeholder="Search eggs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[200px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {eggsData?.categories?.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Eggs Table */}
        <Card>
          <CardHeader>
            <CardTitle>Eggs</CardTitle>
            <CardDescription>
              {filteredEggs.length} egg{filteredEggs.length !== 1 ? 's' : ''} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              <div className="overflow-x-auto"><Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Nest</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Minimum Resources</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEggs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-neutral-500 py-8">
                        {Object.keys(eggsData?.eggs || {}).length === 0 ? (
                          <div className="space-y-2">
                            <Egg className="w-12 h-12 mx-auto text-neutral-600" />
                            <p>No eggs synced yet</p>
                            <ConfirmDialog
                              title="Sync Eggs from Panel?"
                              description="This will fetch all eggs from your Pterodactyl panel. New eggs will be added and existing ones will be updated."
                              confirmText="Sync Now"
                              onConfirm={() => syncMutation.mutate()}
                              trigger={
                                <Button
                                  variant="outline"
                                  size="sm"
                                >
                                  <Download className="w-4 h-4 mr-2" />
                                  Sync from Panel
                                </Button>
                              }
                            />
                          </div>
                        ) : (
                          "No eggs match your filters"
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEggs.map(([id, egg]) => (
                      <TableRow key={id}>
                        <TableCell>
                          {egg.enabled ? (
                            <ConfirmDialog
                              title="Disable Egg?"
                              description={`Are you sure you want to disable ${egg.displayName || egg.originalName}? Users will no longer be able to create servers with this egg.`}
                              onConfirm={() => toggleMutation.mutate(id)}
                              variant="destructive"
                              trigger={
                                <Switch
                                  checked={egg.enabled}
                                  onCheckedChange={() => {}}
                                  disabled={toggleMutation.isLoading}
                                />
                              }
                            />
                          ) : (
                            <Switch
                              checked={egg.enabled}
                              onCheckedChange={() => toggleMutation.mutate(id)}
                              disabled={toggleMutation.isLoading}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-white">
                              {egg.displayName || egg.originalName}
                            </p>
                            {egg.displayName && egg.displayName !== egg.originalName && (
                              <p className="text-xs text-neutral-500">
                                Original: {egg.originalName}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-neutral-400">
                            {egg.nestName}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {eggsData?.categories?.find(c => c.id === egg.category)?.name || egg.category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3 text-xs text-neutral-400">
                            <span className="flex items-center gap-1">
                              <MemoryStick className="w-3 h-3" />
                              {egg.minimum?.ram || 0} MB
                            </span>
                            <span className="flex items-center gap-1">
                              <HardDrive className="w-3 h-3" />
                              {egg.minimum?.disk || 0} MB
                            </span>
                            <span className="flex items-center gap-1">
                              <Cpu className="w-3 h-3" />
                              {egg.minimum?.cpu || 0}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => {
                                setSelectedEgg({ id, ...egg });
                                setIsEditDialogOpen(true);
                              }}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit Configuration
                              </DropdownMenuItem>
                              {egg.enabled ? (
                                <ConfirmDialog
                                  title="Disable Egg?"
                                  description={`Are you sure you want to disable ${egg.displayName || egg.originalName}? Users will no longer be able to create servers with this egg.`}
                                  onConfirm={() => toggleMutation.mutate(id)}
                                  variant="destructive"
                                  trigger={
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                      <X className="w-4 h-4 mr-2" />
                                      Disable
                                    </DropdownMenuItem>
                                  }
                                />
                              ) : (
                                <DropdownMenuItem onClick={() => toggleMutation.mutate(id)}>
                                  <Check className="w-4 h-4 mr-2" />
                                  Enable
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table></div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Edit Egg Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl bg-[#0a0a0a] border-neutral-800">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Egg Configuration</DialogTitle>
            <DialogDescription>
              Customize this egg's settings for your dashboard
            </DialogDescription>
          </DialogHeader>

          {selectedEgg && (
            <div className="space-y-6">
              <Tabs defaultValue="general">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="resources">Resources</TabsTrigger>
                  <TabsTrigger value="advanced">Advanced</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Display Name</Label>
                    <Input
                      value={selectedEgg.displayName || ''}
                      onChange={(e) => setSelectedEgg({
                        ...selectedEgg,
                        displayName: e.target.value
                      })}
                      placeholder={selectedEgg.originalName}
                    />
                    <p className="text-xs text-neutral-500">
                      Original: {selectedEgg.originalName}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={selectedEgg.category}
                      onValueChange={(value) => setSelectedEgg({
                        ...selectedEgg,
                        category: value
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {eggsData?.categories?.map(cat => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enabled</Label>
                      <p className="text-xs text-neutral-500">
                        Allow users to create servers with this egg
                      </p>
                    </div>
                    <Switch
                      checked={selectedEgg.enabled}
                      onCheckedChange={(checked) => setSelectedEgg({
                        ...selectedEgg,
                        enabled: checked
                      })}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="resources" className="space-y-4 mt-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Minimum RAM (MB)</Label>
                      <Input
                        type="number"
                        value={selectedEgg.minimum?.ram || 0}
                        onChange={(e) => setSelectedEgg({
                          ...selectedEgg,
                          minimum: {
                            ...selectedEgg.minimum,
                            ram: parseInt(e.target.value) || 0
                          }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Minimum Disk (MB)</Label>
                      <Input
                        type="number"
                        value={selectedEgg.minimum?.disk || 0}
                        onChange={(e) => setSelectedEgg({
                          ...selectedEgg,
                          minimum: {
                            ...selectedEgg.minimum,
                            disk: parseInt(e.target.value) || 0
                          }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Minimum CPU (%)</Label>
                      <Input
                        type="number"
                        value={selectedEgg.minimum?.cpu || 0}
                        onChange={(e) => setSelectedEgg({
                          ...selectedEgg,
                          minimum: {
                            ...selectedEgg.minimum,
                            cpu: parseInt(e.target.value) || 0
                          }
                        })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Database Limit</Label>
                      <Input
                        type="number"
                        value={selectedEgg.featureLimits?.databases ?? 0}
                        onChange={(e) => setSelectedEgg({
                          ...selectedEgg,
                          featureLimits: {
                            ...selectedEgg.featureLimits,
                            databases: parseInt(e.target.value) || 0
                          }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Backup Limit</Label>
                      <Input
                        type="number"
                        value={selectedEgg.featureLimits?.backups ?? 0}
                        onChange={(e) => setSelectedEgg({
                          ...selectedEgg,
                          featureLimits: {
                            ...selectedEgg.featureLimits,
                            backups: parseInt(e.target.value) || 0
                          }
                        })}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="advanced" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Docker Image</Label>
                    <Input
                      value={selectedEgg.dockerImage || ''}
                      onChange={(e) => setSelectedEgg({
                        ...selectedEgg,
                        dockerImage: e.target.value
                      })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Startup Command</Label>
                    <Input
                      value={selectedEgg.startup || ''}
                      onChange={(e) => setSelectedEgg({
                        ...selectedEgg,
                        startup: e.target.value
                      })}
                    />
                  </div>

                  <Alert className="bg-neutral-900 border-neutral-800 flex items-center gap-3">
                    <AlertCircle className="h-4 w-4 text-neutral-400 shrink-0" />
                    <AlertDescription className="text-xs text-neutral-300">
                      Advanced settings override the Pterodactyl egg configuration. Changes will be preserved on sync.
                    </AlertDescription>
                  </Alert>
                </TabsContent>
              </Tabs>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const { id, ...updates } = selectedEgg;
                updateMutation.mutate({ eggId: id, updates });
              }}
              disabled={updateMutation.isLoading}
            >
              {updateMutation.isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Category Dialog */}
      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="bg-[#0a0a0a] border-neutral-800">
          <DialogHeader>
            <DialogTitle className="text-white">Create Category</DialogTitle>
            <DialogDescription>
              Add a new category to organize your eggs
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category ID</Label>
              <Input
                value={newCategory.id}
                onChange={(e) => setNewCategory({
                  ...newCategory,
                  id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
                })}
                placeholder="e.g. minecraft, bots, web"
              />
              <p className="text-xs text-neutral-500">
                Lowercase letters, numbers and dashes only
              </p>
            </div>

            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                value={newCategory.name}
                onChange={(e) => setNewCategory({
                  ...newCategory,
                  name: e.target.value
                })}
                placeholder="e.g. Minecraft Servers"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCategoryDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createCategoryMutation.mutate(newCategory)}
              disabled={!newCategory.id || !newCategory.name || createCategoryMutation.isLoading}
            >
              {createCategoryMutation.isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Category'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
