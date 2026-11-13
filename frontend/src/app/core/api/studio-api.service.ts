import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AddMemberRequest,
  CreateStudioRequest,
  MemberDto,
  StudioDto,
  StudioSnapshotDto,
  StudioSummaryDto,
  UpdateMemberRequest,
  UpdateStudioRequest,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class StudioApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<StudioSummaryDto[]> {
    return this.http.get<StudioSummaryDto[]>(API_PATHS.studios.list());
  }

  create(body: CreateStudioRequest): Observable<StudioSummaryDto> {
    return this.http.post<StudioSummaryDto>(API_PATHS.studios.create(), body);
  }

  snapshot(studioId: string): Observable<StudioSnapshotDto> {
    return this.http.get<StudioSnapshotDto>(API_PATHS.studios.snapshot(studioId));
  }

  update(studioId: string, body: UpdateStudioRequest): Observable<StudioDto> {
    return this.http.patch<StudioDto>(API_PATHS.studios.byId(studioId), body);
  }

  pause(studioId: string): Observable<StudioDto> {
    return this.http.post<StudioDto>(API_PATHS.studios.pause(studioId), {});
  }

  resume(studioId: string): Observable<StudioDto> {
    return this.http.post<StudioDto>(API_PATHS.studios.resume(studioId), {});
  }

  listMembers(studioId: string): Observable<MemberDto[]> {
    return this.http.get<MemberDto[]>(API_PATHS.studios.members(studioId));
  }

  addMember(studioId: string, body: AddMemberRequest): Observable<MemberDto> {
    return this.http.post<MemberDto>(API_PATHS.studios.members(studioId), body);
  }

  updateMember(
    studioId: string,
    userId: string,
    body: UpdateMemberRequest,
  ): Observable<MemberDto> {
    return this.http.patch<MemberDto>(API_PATHS.studios.memberByUser(studioId, userId), body);
  }

  removeMember(studioId: string, userId: string): Observable<void> {
    return this.http.delete<void>(API_PATHS.studios.memberByUser(studioId, userId));
  }
}
