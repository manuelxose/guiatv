import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import {
  AdminUser,
  AdminUserRole,
  AdminUserStatus,
  AdminUsersService,
} from '../../../../services/admin-users.service';
import { AdminConfirmDialogComponent } from '../../components/admin-confirm-dialog/admin-confirm-dialog.component';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-admin-users-section',
  standalone: true,
  imports: [CommonModule, AdminConfirmDialogComponent],
  templateUrl: './admin-users-section.component.html',
  styleUrls: ['./admin-users-section.component.scss'],
})
export class AdminUsersSectionComponent implements OnInit {
  @Input() activeItem = 'accounts';
  @Output() lastUpdatedChange = new EventEmitter<Date>();

  public users: AdminUser[] = [];
  public loading = false;
  public error: string | null = null;

  public search = '';
  public roleFilter: 'all' | AdminUserRole = 'all';
  public statusFilter: 'all' | AdminUserStatus = 'all';
  public page = 1;
  public limit = 20;
  public total = 0;
  public adminCount: number | null = null;
  public suspendedCount: number | null = null;
  public pages = 1;

  public readonly roleOptions: Array<{ id: 'all' | AdminUserRole; label: string }> = [
    { id: 'all', label: 'All roles' },
    { id: 'admin', label: 'Admin' },
    { id: 'editor', label: 'Editor' },
    { id: 'user', label: 'User' },
  ];

  public readonly statusOptions: Array<{ id: 'all' | AdminUserStatus; label: string }> = [
    { id: 'all', label: 'All status' },
    { id: 'active', label: 'Active' },
    { id: 'suspended', label: 'Suspended' },
  ];

  public confirmSuspendOpen = false;
  public pendingSuspendUser: AdminUser | null = null;

  private savingIds = new Set<string>();

  private readonly viewLabels: Record<
    string,
    { title: string; description: string }
  > = {
    accounts: {
      title: 'Users',
      description: 'Manage accounts, roles, and status.',
    },
    segments: {
      title: 'Segments',
      description: 'Filter and segment users by role and status.',
    },
    moderation: {
      title: 'Moderation',
      description: 'Review user status changes and enforcement.',
    },
    roles: {
      title: 'Roles & Access',
      description: 'Assign permissions and manage access levels.',
    },
  };

  constructor(private usersService: AdminUsersService) {}

  get viewTitle(): string {
    return this.viewLabels[this.activeItem]?.title || 'Users';
  }

  get viewDescription(): string {
    return this.viewLabels[this.activeItem]?.description || 'Manage users.';
  }

  ngOnInit(): void {
    this.loadUsers();
  }

  refresh(): void {
    this.page = 1;
    this.loadUsers(true);
  }

  inviteUser(): void {
    window.open(`${environment.SITE_URL}/registro`, '_blank', 'noopener');
  }

  applyFilters(): void {
    this.page = 1;
    this.loadUsers(true);
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.search = target?.value || '';
  }

  changeRole(user: AdminUser, role: AdminUserRole): void {
    if (!user.id || user.role === role) return;
    this.saveUser(user.id, { role }, () => {
      user.role = role;
    });
  }

  toggleStatus(user: AdminUser): void {
    if (!user.id) return;
    if (user.status === 'suspended') {
      // Reactivating access is restorative, not destructive: apply directly.
      this.saveUser(user.id, { status: 'active' }, () => {
        user.status = 'active';
      });
      return;
    }
    // Suspending access is a destructive, user-impacting action: confirm first.
    this.pendingSuspendUser = user;
    this.confirmSuspendOpen = true;
  }

  cancelSuspend(): void {
    this.pendingSuspendUser = null;
    this.confirmSuspendOpen = false;
  }

  confirmSuspend(): void {
    const user = this.pendingSuspendUser;
    if (!user?.id) return;
    this.saveUser(user.id, { status: 'suspended' }, () => {
      user.status = 'suspended';
      this.confirmSuspendOpen = false;
      this.pendingSuspendUser = null;
    });
  }

  canSave(userId: string): boolean {
    return !this.savingIds.has(userId);
  }

  getStatusBadge(status?: AdminUserStatus): string {
    if (status === 'suspended') {
      return 'bg-[var(--spotify-warning)]/20 text-[var(--spotify-warning)] border-[var(--spotify-warning)]/40';
    }
    return 'bg-[var(--accent-discover)]/20 text-[var(--accent-discover)] border-[var(--accent-discover)]/40';
  }

  formatDate(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    return isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
  }

  trackByUser(_index: number, user: AdminUser): string {
    return user.id;
  }

  nextPage(): void {
    if (this.page >= this.pages) return;
    this.page += 1;
    this.loadUsers(true);
  }

  prevPage(): void {
    if (this.page <= 1) return;
    this.page -= 1;
    this.loadUsers(true);
  }

  private loadUsers(force = false): void {
    if (this.loading) return;
    if (!force && this.users.length > 0) return;

    this.loading = true;
    this.error = null;

    this.usersService
      .getUsers({
        search: this.search.trim() || undefined,
        role: this.roleFilter,
        status: this.statusFilter,
        page: this.page,
        limit: this.limit,
      })
      .subscribe({
        next: (response) => {
          this.users = response.users || [];
          this.total = response.pagination?.total || 0;
          this.adminCount = response.counts?.admins ?? null;
          this.suspendedCount = response.counts?.suspended ?? null;
          this.page = response.pagination?.page || this.page;
          this.limit = response.pagination?.limit || this.limit;
          this.pages = response.pagination?.pages || 1;
          this.loading = false;
          this.lastUpdatedChange.emit(new Date());
        },
        error: () => {
          this.loading = false;
          this.error = 'Failed to load users.';
        },
      });
  }

  private saveUser(
    userId: string,
    payload: { role?: AdminUserRole; status?: AdminUserStatus },
    onSuccess: () => void
  ): void {
    if (this.savingIds.has(userId)) return;
    this.savingIds.add(userId);
    this.usersService.updateUser(userId, payload).subscribe({
      next: () => {
        this.savingIds.delete(userId);
        this.error = null;
        onSuccess();
        this.lastUpdatedChange.emit(new Date());
      },
      error: () => {
        this.savingIds.delete(userId);
        this.error = 'Failed to update user.';
      },
    });
  }
}
