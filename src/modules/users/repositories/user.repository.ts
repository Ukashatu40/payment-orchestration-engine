// src/modules/users/repositories/user.repository.ts

import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User, UserStatus } from '../entities/user.entity';
import { UserRole } from '../../../common/enums';

@Injectable()
export class UserRepository {
  private readonly repo: Repository<User>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(User);
  }

  // The only lookup that selects password_hash — used exclusively by
  // the login flow. Every other read must go through findById/findAll
  // below, which never touch the hash (select: false on the column).
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
  }

  async findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findAllPaginated(params: {
    role?: UserRole;
    status?: UserStatus;
    page: number;
    pageSize: number;
  }): Promise<{ data: User[]; total: number }> {
    const qb = this.repo.createQueryBuilder('u').orderBy('u.createdAt', 'DESC');

    if (params.role) {
      qb.andWhere('u.role = :role', { role: params.role });
    }
    if (params.status) {
      qb.andWhere('u.status = :status', { status: params.status });
    }

    qb.skip((params.page - 1) * params.pageSize).take(params.pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.repo.count({ where: { email } });
    return count > 0;
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<void> {
    await this.repo.update({ id }, data);
  }

  async recordLoginSuccess(id: string): Promise<void> {
    await this.repo.update(
      { id },
      { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    );
  }

  async recordLoginFailure(
    id: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await this.repo.update({ id }, { failedLoginCount, lockedUntil });
  }
}
