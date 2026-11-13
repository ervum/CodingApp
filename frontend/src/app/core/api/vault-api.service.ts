import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateVaultDocumentRequest,
  CreateVaultFolderRequest,
  SaveVaultDocumentRequest,
  VaultDocumentDto,
  VaultGraphDto,
  VaultRevisionDto,
  VaultSearchHitDto,
  VaultTreeNodeDto,
} from '@robdev/shared';
import type { Observable } from 'rxjs';
import { API_PATHS } from './api-paths';

@Injectable({ providedIn: 'root' })
export class VaultApiService {
  private readonly http = inject(HttpClient);

  tree(studioId: string): Observable<VaultTreeNodeDto[]> {
    return this.http.get<VaultTreeNodeDto[]>(API_PATHS.vault.tree(studioId));
  }

  getGraph(studioId: string): Observable<VaultGraphDto> {
    return this.http.get<VaultGraphDto>(API_PATHS.vault.graph(studioId));
  }

  search(studioId: string, q: string, limit = 20): Observable<VaultSearchHitDto[]> {
    const params = new HttpParams().set('q', q).set('limit', String(limit));
    return this.http.get<VaultSearchHitDto[]>(API_PATHS.vault.search(studioId), { params });
  }

  getByPath(studioId: string, path: string): Observable<VaultDocumentDto> {
    const params = new HttpParams().set('path', path);
    return this.http.get<VaultDocumentDto>(API_PATHS.vault.byPath(studioId), { params });
  }

  getDocument(studioId: string, docId: string): Observable<VaultDocumentDto> {
    return this.http.get<VaultDocumentDto>(API_PATHS.vault.documentById(studioId, docId));
  }

  createDocument(
    studioId: string,
    body: CreateVaultDocumentRequest,
  ): Observable<VaultDocumentDto> {
    return this.http.post<VaultDocumentDto>(API_PATHS.vault.documents(studioId), body);
  }

  saveDocument(
    studioId: string,
    docId: string,
    body: SaveVaultDocumentRequest,
  ): Observable<VaultDocumentDto> {
    return this.http.put<VaultDocumentDto>(API_PATHS.vault.documentById(studioId, docId), body);
  }

  deleteDocument(studioId: string, docId: string): Observable<void> {
    return this.http.delete<void>(API_PATHS.vault.documentById(studioId, docId));
  }

  listRevisions(studioId: string, docId: string): Observable<VaultRevisionDto[]> {
    return this.http.get<VaultRevisionDto[]>(API_PATHS.vault.revisions(studioId, docId));
  }

  getRevision(
    studioId: string,
    docId: string,
    version: number,
  ): Observable<{ version: number; markdown: string }> {
    return this.http.get<{ version: number; markdown: string }>(
      API_PATHS.vault.revisionByVersion(studioId, docId, version),
    );
  }

  createFolder(studioId: string, body: CreateVaultFolderRequest): Observable<VaultTreeNodeDto> {
    return this.http.post<VaultTreeNodeDto>(API_PATHS.vault.folders(studioId), body);
  }
}
