'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import type { UserListItem } from '@/actions/users'
import { updateUserRole, setUserActive } from '@/actions/users'
import { ROLES } from '@/lib/validations/users'
import type { Role } from '@/lib/auth/require-role'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { InviteUserDialog } from './invite-user-dialog'

interface UserListProps {
  users: UserListItem[]
  currentUserId: string
}

export function UserList({ users, currentUserId }: UserListProps) {
  const router = useRouter()
  const [showInvite, setShowInvite] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRoleChange(userId: string, role: Role) {
    startTransition(async () => {
      const res = await updateUserRole(userId, role)
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Role updated')
        router.refresh()
      }
    })
  }

  function handleToggleActive(userId: string, currentActive: boolean) {
    startTransition(async () => {
      const res = await setUserActive(userId, !currentActive)
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success(currentActive ? 'User deactivated' : 'User activated')
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Users</CardTitle>
        <Button size="sm" onClick={() => setShowInvite(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Invite User
        </Button>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No users yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isSelf = u.id === currentUserId
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.full_name}
                      {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        disabled={isSelf || isPending}
                        onValueChange={(v) => handleRoleChange(u.id, v as Role)}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? 'default' : 'secondary'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isSelf || isPending}
                        onClick={() => handleToggleActive(u.id, u.is_active)}
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <InviteUserDialog
        open={showInvite}
        onOpenChange={setShowInvite}
        onSuccess={() => {
          setShowInvite(false)
          router.refresh()
        }}
      />
    </Card>
  )
}
