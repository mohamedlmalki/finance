import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { NavLink } from 'react-router-dom';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableSidebarItem } from './SortableSidebarItem'; // Your copied component


export function SortableSidebarItem({ id, to, children, icon: Icon }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative flex items-center gap-1">
      {/* The actual drag handle */}
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
        <GripVertical className="h-3 w-3" />
      </div>
      
      <NavLink
        to={to}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary flex-1",
            isActive ? "bg-muted text-primary" : "text-muted-foreground"
          )
        }
      >
        <Icon className="h-4 w-4" />
        {children}
      </NavLink>
    </div>
  );
}