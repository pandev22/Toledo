import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  ServerIcon, PlusIcon, CpuChipIcon,
  ChartPieIcon, ArchiveBoxIcon, ArrowPathIcon,
  ExclamationCircleIcon, CommandLineIcon, PencilIcon,
  TrashIcon, UsersIcon, CheckIcon, EllipsisVerticalIcon,
  BoltIcon, GlobeAltIcon, CircleStackIcon
} from '@heroicons/react/24/outline';
import { ChartPie, Users, Server, CircuitBoard, MapPin } from 'lucide-react';
import { FAQSection } from '../components/FAQSection';
import { Card, CardContent } from '@/components/ui/card';
import { useSettings } from '@/hooks/useSettings';

// Utility function to format bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 MB';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const ResourceCard = React.memo(function ResourceCard({ icon: Icon, title, used, total, unit, isBoosted }) {
  const { percentage, colorClass, formattedUsed, formattedTotal } = useMemo(() => {
    const pct = total ? (used / total) * 100 : 0;
    const color = pct > 100 && !isBoosted ? 'bg-red-500' :
                  pct > 90 && !isBoosted ? 'bg-red-500' :
                  pct > 70 ? 'bg-amber-500' : 'bg-neutral-300';
    
    // Format values to avoid long decimals (e.g. 22.99609375GB)
    // Using Math.floor to keep digits without rounding up as requested
    const formatValue = (val) => {
      if (typeof val !== 'number') return val;
      return Math.floor(val * 100) / 100;
    };

    return { 
      percentage: pct, 
      colorClass: color,
      formattedUsed: formatValue(used),
      formattedTotal: formatValue(total)
    };
  }, [used, total, isBoosted]);

  return (
    <div className={`border ${isBoosted ? 'border-amber-500/30 bg-amber-500/5' : 'border-[#2e3337]/50 bg-transparent'} shadow-xs rounded-lg p-4 relative overflow-hidden`}>
      <div className="flex items-center justify-between pb-2 mt-1 relative z-0">
        <div className="flex items-center gap-2">
          <h3 className={`text-sm font-medium flex items-center gap-2 ${isBoosted ? 'text-amber-500' : ''}`}>
            {title}
            {isBoosted && <BoltIcon className="w-3.5 h-3.5 animate-pulse" />}
          </h3>
        </div>
        <span className="text-xs text-[#95a1ad]">
          {formattedUsed}{unit} / {formattedTotal}{unit}
        </span>
      </div>
      <div>
        <div className="h-1 bg-[#202229] rounded-full overflow-hidden">
          <div
            className={`h-full ${isBoosted ? 'bg-gradient-to-r from-amber-600 to-amber-400' : colorClass} rounded-full`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          ></div>
        </div>
        <div className="flex justify-between items-center mt-2">
          <p className="text-xs text-[#95a1ad]">
            {percentage.toFixed(1)}% utilized
          </p>
          {isBoosted && (
            <span className="text-[0.60rem] text-amber-500/80 font-medium uppercase tracking-wider mr-1">
              ACTIVE BOOST
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

function CreateServerModal({ isOpen, onClose }) {
  const [name, setName] = useState('');
  const [egg, setEgg] = useState('');
  const [location, setLocation] = useState('');
  const [ram, setRam] = useState('');
  const [disk, setDisk] = useState('');
  const [cpu, setCpu] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [animationClass, setAnimationClass] = useState('');

  const [showEggDropdown, setShowEggDropdown] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

  const eggDropdownRef = useRef(null);
  const locationDropdownRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      // Small delay to ensure DOM updates before starting animation
      setTimeout(() => setAnimationClass('opacity-100 scale-100'), 10);
    } else {
      setAnimationClass('opacity-0 scale-95');
      setTimeout(() => setIsVisible(false), 300); // Match with transition duration
    }
  }, [isOpen]);

  const { data: eggs } = useQuery({
    queryKey: ['eggs'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v5/eggs');
      return data;
    }
  });

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v5/locations');
      return data;
    }
  });

  const selectedEgg = Array.isArray(eggs) ? eggs.find(e => e.id === egg) : null;

  // Handle clicks outside dropdowns
  useEffect(() => {
    function handleClickOutside(event) {
      if (eggDropdownRef.current && !eggDropdownRef.current.contains(event.target)) {
        setShowEggDropdown(false);
      }
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(event.target)) {
        setShowLocationDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCreate = async () => {
    try {
      setError('');
      setIsCreating(true);

      if (!name?.trim()) throw new Error('Server name is required');
      if (!egg) throw new Error('Server type is required');
      if (!location) throw new Error('Location is required');
      if (!ram || !disk || !cpu) throw new Error('Resource values are required');

      await axios.post('/api/v5/servers', {
        name: name.trim(),
        egg,
        location,
        ram: parseInt(ram),
        disk: parseInt(disk),
        cpu: parseInt(cpu)
      });

      onClose();
      // Redirect to servers page or reload
      window.location.href = '/servers';
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen && !isVisible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div
        className={`fixed inset-0 transition-opacity duration-300 ${animationClass}`}
        onClick={onClose}
      ></div>
      <div
        className={`relative bg-[#202229] border border-white/5 rounded-lg w-full max-w-xs md:max-w-lg p-6 transition-all duration-300 ${animationClass}`}
      >
        <div className="mb-4">
          <h2 className="text-lg font-medium">Create New Server</h2>
        </div>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <label className="text-sm text-[#95a1ad] block">Server Name</label>
            <input
              placeholder="My Awesome Server"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-[#394047] focus:bg-[#394047]/50 border border-white/5 focus:border-white/5 focus:ring-1 focus:ring-white/20 rounded-md p-2 text-sm focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-2" ref={eggDropdownRef}>
            <label className="text-sm text-[#95a1ad] block">Server Type</label>
            <div className="relative">
              <button
                type="button"
                className="w-full bg-[#394047] border border-white/5 rounded-md p-2 text-sm flex justify-between items-center focus:outline-none focus:bg-[#394047]/50 focus:border-white/5 focus:ring-1 focus:ring-white/20 transition-colors"
                onClick={() => setShowEggDropdown(!showEggDropdown)}
              >
                <span className={egg ? "text-white" : "text-[#95a1ad]"}>
                  {Array.isArray(eggs) ? eggs.find(e => e.id === egg)?.name : "Select Server Type"}
                </span>
                <svg className="h-5 w-5 text-[#95a1ad]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>

              {showEggDropdown && (
                <div className="absolute z-10 mt-1 w-full bg-[#202229] border border-white/5 rounded-md shadow-lg max-h-60 overflow-auto">
                  {Array.isArray(eggs) && eggs.map(eggItem => (
                    <button
                      key={eggItem.id}
                      className="block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors"
                      onClick={() => {
                        setEgg(eggItem.id);
                        setShowEggDropdown(false);
                      }}
                    >
                      {eggItem.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2" ref={locationDropdownRef}>
            <label className="text-sm text-[#95a1ad] block">Location</label>
            <div className="relative">
              <button
                type="button"
                className="w-full bg-[#394047] border border-white/5 rounded-md p-2 text-sm flex justify-between items-center focus:outline-none focus:bg-[#394047]/50 focus:border-white/5 focus:ring-1 focus:ring-white/20 transition-colors"
                onClick={() => setShowLocationDropdown(!showLocationDropdown)}
              >
                <span className={location ? "text-white" : "text-[#95a1ad]"}>
                  {Array.isArray(locations) ? locations.find(loc => loc.id === location)?.name : "Select Location"}
                </span>
                <svg className="h-5 w-5 text-[#95a1ad]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>

              {showLocationDropdown && (
                <div className="absolute z-10 mt-1 w-full bg-[#202229] border border-white/5 rounded-md shadow-lg max-h-60 overflow-auto">
                  {Array.isArray(locations) && locations.map(locationItem => (
                    <button
                      key={locationItem.id}
                      className="block w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors"
                      onClick={() => {
                        setLocation(locationItem.id);
                        setShowLocationDropdown(false);
                      }}
                    >
                      {locationItem.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-[#95a1ad] block">RAM (MB)</label>
              <input
                type="number"
                placeholder="2048"
                value={ram}
                onChange={e => setRam(e.target.value)}
                className="w-full bg-[#394047] focus:bg-[#394047]/50 border border-white/5 focus:border-white/5 focus:ring-1 focus:ring-white/20 rounded-md p-2 text-sm focus:outline-none transition-colors"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[#95a1ad] block">Disk (MB)</label>
              <input
                type="number"
                placeholder="10240"
                value={disk}
                onChange={e => setDisk(e.target.value)}
                className="w-full bg-[#394047] focus:bg-[#394047]/50 border border-white/5 focus:border-white/5 focus:ring-1 focus:ring-white/20 rounded-md p-2 text-sm focus:outline-none transition-colors"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-[#95a1ad] block">CPU (%)</label>
              <input
                type="number"
                placeholder="100"
                value={cpu}
                onChange={e => setCpu(e.target.value)}
                className="w-full bg-[#394047] focus:bg-[#394047]/50 border border-white/5 focus:border-white/5 focus:ring-1 focus:ring-white/20 rounded-md p-2 text-sm focus:outline-none transition-colors"
              />
            </div>
          </div>

          {selectedEgg && (
            <div className="rounded-md border border-blue-500/20 bg-blue-500/10 text-blue-500 p-3 flex items-start">
              <ExclamationCircleIcon className="w-4 h-4 mt-0.5 mr-2 flex-shrink-0" />
              <span className="text-sm">
                Minimum requirements: {selectedEgg.minimum.ram}MB RAM, {selectedEgg.minimum.disk}MB Disk, {selectedEgg.minimum.cpu}% CPU
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 text-red-500 p-3 flex items-start">
              <ExclamationCircleIcon className="w-4 h-4 mt-0.5 mr-2 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-white/5 text-[#95a1ad] hover:text-white hover:bg-white/5 font-medium text-sm transition active:scale-95"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-4 py-2 bg-white text-black hover:bg-white/90 rounded-md font-medium text-sm transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {isCreating ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
            Create Server
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 bg-[#202229] rounded-md animate-pulse"></div>
        <div className="h-9 w-32 bg-[#202229] rounded-md animate-pulse"></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="border border-[#2e3337] rounded-lg p-4">
            <div className="flex items-center pb-2">
              <div className="w-8 h-8 rounded-lg bg-[#202229] animate-pulse mr-2"></div>
              <div className="h-6 w-32 bg-[#202229] rounded animate-pulse"></div>
            </div>
            <div className="h-1 w-full bg-[#202229] rounded-full animate-pulse"></div>
            <div className="h-4 w-20 mt-2 bg-[#202229] rounded animate-pulse"></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { settings } = useSettings();

  const { data: resources, isLoading: loadingResources } = useQuery({
    queryKey: ['resources'],
    queryFn: async () => {
      const { data } = await axios.get('/api/v5/resources');
      return data;
    },
    staleTime: 30000,
  });

  const { data: activeBoosts } = useQuery({
    queryKey: ['active-boosts'],
    queryFn: async () => {
      try {
        const { data } = await axios.get('/api/boosts/active');
        return data;
      } catch (error) {
        if (error.response?.status === 403 && error.response?.data?.error === 'Server boosts are currently disabled') {
          return null;
        }
        throw error;
      }
    },
    // Don't block loading
    enabled: settings?.features?.boosts !== false,
    retry: false,
    staleTime: 30000,
  });

  const { data: platformStats } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: async () => {
      const { data } = await axios.get('/api/stats');
      return data;
    },
    retry: false,
    staleTime: 30000,
  });

  // Calculate boosted resources
  const boostedResources = {
    ram: false,
    cpu: false,
    disk: false
  };

  if (activeBoosts) {
    Object.values(activeBoosts).forEach(serverBoosts => {
      Object.values(serverBoosts).forEach(boost => {
        if (boost.boostType === 'memory' || boost.boostType === 'performance' || boost.boostType === 'extreme') {
          boostedResources.ram = true;
        }
        if (boost.boostType === 'cpu' || boost.boostType === 'performance' || boost.boostType === 'extreme') {
          boostedResources.cpu = true;
        }
        if (boost.boostType === 'storage' || boost.boostType === 'performance' || boost.boostType === 'extreme') {
          boostedResources.disk = true;
        }
      });
    });
  }

  if (loadingResources) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-8 p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-white text-black hover:bg-white/90 rounded-md font-medium text-sm transition active:scale-95 flex items-center gap-2"
        >
          <PlusIcon className="w-4 h-4" />
          New Server
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ResourceCard
          icon={ChartPieIcon}
          title="Memory"
          used={resources?.current?.ram / 1024 || 0}
          total={resources?.limits?.ram / 1024 || 0}
          unit="GB"
          isBoosted={boostedResources.ram}
        />
        <ResourceCard
          icon={CpuChipIcon}
          title="CPU"
          used={resources?.current?.cpu || 0}
          total={resources?.limits?.cpu || 0}
          unit="%"
          isBoosted={boostedResources.cpu}
        />
        <ResourceCard
          icon={ArchiveBoxIcon}
          title="Storage"
          used={resources?.current?.disk / 1024 || 0}
          total={resources?.limits?.disk / 1024 || 0}
          unit="GB"
          isBoosted={boostedResources.disk}
        />
        <ResourceCard
          icon={ServerIcon}
          title="Servers"
          used={resources?.current?.servers || 0}
          total={resources?.limits?.servers || 0}
          unit=""
        />
      </div>

      {/* FAQ Section */}
      <FAQSection />

      {/* Platform Statistics */}
      <div className="mt-8">
        <h2 className="text-lg font-medium mb-4">Platform Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="border border-[#2e3337]/50 bg-transparent rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#202229] rounded-lg">
                <Users className="w-5 h-5 text-[#95a1ad]" />
              </div>
              <div>
                <p className="text-xs text-[#95a1ad]">Total Users</p>
                <p className="text-xl font-semibold text-white">
                  {platformStats?.totalUsers?.toLocaleString() || '-'}
                </p>
              </div>
            </div>
          </div>
          
          <div className="border border-[#2e3337]/50 bg-transparent rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#202229] rounded-lg">
                <Server className="w-5 h-5 text-[#95a1ad]" />
              </div>
              <div>
                <p className="text-xs text-[#95a1ad]">Active Servers</p>
                <p className="text-xl font-semibold text-white">
                  {platformStats?.totalServers?.toLocaleString() || '-'}
                </p>
              </div>
            </div>
          </div>
          
          <div className="border border-[#2e3337]/50 bg-transparent rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#202229] rounded-lg">
                <CircuitBoard className="w-5 h-5 text-[#95a1ad]" />
              </div>
              <div>
                <p className="text-xs text-[#95a1ad]">Nodes</p>
                <p className="text-xl font-semibold text-white">
                  {platformStats?.totalNodes?.toLocaleString() || '-'}
                </p>
              </div>
            </div>
          </div>
          
          <div className="border border-[#2e3337]/50 bg-transparent rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#202229] rounded-lg">
                <MapPin className="w-5 h-5 text-[#95a1ad]" />
              </div>
              <div>
                <p className="text-xs text-[#95a1ad]">Locations</p>
                <p className="text-xl font-semibold text-white">
                  {platformStats?.totalLocations?.toLocaleString() || '-'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Server Modal */}
      <CreateServerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
