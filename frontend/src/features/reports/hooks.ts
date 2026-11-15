import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/core/api/ApiProvider";
import { keys } from "@/core/api/keys";
import type { AreaListParams, Report, ReportListParams, ReportRequest } from "@/types/api";

export const REPORT_PAGE_SIZE = 20;
export const REPORT_AREA_PARAMS: AreaListParams = { status: "active", limit: 200, offset: 0 };

export function useReportList(params: ReportListParams) {
  const api = useApi();
  return useQuery({ queryKey: keys.reports(params), queryFn: ({ signal }) => api.listReports(params, { signal }) });
}

/** The areas a report can be created for (frontend design, Reports). */
export function useReportAreas(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.areas(REPORT_AREA_PARAMS),
    queryFn: ({ signal }) => api.listAreas(REPORT_AREA_PARAMS, { signal }),
    enabled,
  });
}

/** One request; the raw text is kept for "Download JSON" (Requirement 15.11). */
export function useReport(reportId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.report(reportId), queryFn: ({ signal }) => api.getReportJson(reportId, { signal }) });
}

export function useCreateReport() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation<Report, unknown, ReportRequest>({
    mutationFn: (body) => api.createReport(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports"] }),
  });
}
