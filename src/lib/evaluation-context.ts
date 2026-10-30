import { supabase } from "@/integrations/supabase/client";

const db = () => supabase as any;
const INCIDENT_JSON_PREFIX = "__ICC_INCIDENTS_V2__";

export type TrainingMarker = {
  pathId: string;
  name: string;
  poleId: string;
  poleName: string;
  kind: "integration" | "internal";
  status: string;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type EvaluationFacts = {
  activity: {
    assigned: number;
    attended: number;
    present: number;
    late: number;
    absent: number;
    partial: number;
  };
  attendanceDetails: Array<{
    programId: string;
    programTitle: string;
    date: string | null;
    presence: string;
    arrivalTime: string | null;
    departureTime: string | null;
    justified: boolean | null;
    reason: string | null;
  }>;
  engagement: {
    reinforcements: number;
    replacements: number;
  };
  reliability: {
    presenceRate: number | null;
    responsesAnswered: number;
    responsesTotal: number;
  };
  autonomous: { assigned: number; completed: number; contributions: number; periods: Array<{ title: string; status: string }> };
  postService: {
    incidentsExplicitlyLinked: number;
    positiveProgramNotes: number;
    improvementProgramNotes: number;
  };
  referent: {
    referentPoles: string[];
    programsInPoles: number;
    coverageRate: number | null;
    replacementsManaged: number;
    peopleInTraining: number;
    skillsValidated: number;
  } | null;
  training: TrainingMarker[];
  currentFunction: {
    poles: string[];
    referentPoles: string[];
  };
};

function pct(done: number, total: number) {
  if (!total) return null;
  return Math.round((done / total) * 100);
}

function decodeIncidents(detail: string | null | undefined) {
  if (!detail?.startsWith(INCIDENT_JSON_PREFIX)) return [] as Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(detail.slice(INCIDENT_JSON_PREFIX.length));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as Array<Record<string, unknown>>;
  }
}

export async function getEvaluationFacts(memberId: string, periodStart: string, periodEnd: string): Promise<EvaluationFacts> {
  const [programRes, assignmentRes, assignmentMemberRes, attendanceRes, debriefRes, memberPoleRes, poleRes, pathRes, stepRes, memberPathRes, solicitationRes, solicitationRecipientRes, memberIdentityRes, autonomousPeriodsRes] = await Promise.all([
    db().from("programs").select("id,title,start_date,status").gte("start_date", periodStart).lte("start_date", periodEnd).eq("deleted", false),
    db().from("program_assignments").select("id,program_id,pole_id,required_count"),
    db().from("program_assignment_members").select("assignment_id,member_id"),
    db().from("program_attendance").select("program_id,member_id,presence,is_reinforcement,replaced_member_id,arrival_time,departure_time,justified,justification_reason,note"),
    db().from("program_debriefs").select("program_id,went_well,to_improve,incident_detail,incident_type"),
    db().from("member_poles").select("member_id,pole_id,is_referent"),
    db().from("poles").select("id,name,archived"),
    db().from("training_paths").select("id,pole_id,name,path_kind,archived"),
    db().from("training_steps").select("id,path_id,required"),
    db().from("member_training_paths").select("id,member_id,path_id,status,started_at,completed_at").eq("member_id", memberId),
    db().from("solicitations").select("id,event_date,status,deleted,cancelled_at").gte("event_date", periodStart).lte("event_date", periodEnd).eq("deleted", false),
    db().from("solicitation_recipients").select("solicitation_id,member_id,response,responded_at,selected").eq("member_id", memberId),
    db().from("members").select("auth_user_id").eq("id", memberId).maybeSingle(),
    db().from("autonomous_service_periods").select("id,title,starts_on,ends_on,status,model_id").lte("starts_on",periodEnd).gte("ends_on",periodStart).neq("status","archived"),
  ]);

  for (const result of [programRes, assignmentRes, assignmentMemberRes, attendanceRes, debriefRes, memberPoleRes, poleRes, pathRes, stepRes, memberPathRes, solicitationRes, solicitationRecipientRes, memberIdentityRes, autonomousPeriodsRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const autonomousPeriods = autonomousPeriodsRes.data ?? [];
  const autonomousPeriodIds = autonomousPeriods.map((p: any) => p.id);
  const autonomousAssignmentsRes = autonomousPeriodIds.length && memberIdentityRes.data?.auth_user_id
    ? await db().from("autonomous_service_assignments").select("id,period_id,status").eq("user_id",memberIdentityRes.data.auth_user_id).in("period_id",autonomousPeriodIds).in("status",["confirmed","completed","replaced"])
    : {data:[],error:null};
  if (autonomousAssignmentsRes.error) throw new Error(autonomousAssignmentsRes.error.message);
  const autonomousAssignmentRows = autonomousAssignmentsRes.data ?? [];
  const autonomousDebriefsRes = autonomousPeriodIds.length
    ? await db().from("autonomous_service_debriefs").select("id,period_id,status").in("period_id",autonomousPeriodIds)
    : {data:[],error:null};
  if (autonomousDebriefsRes.error) throw new Error(autonomousDebriefsRes.error.message);
  const autonomousDebriefIds = (autonomousDebriefsRes.data ?? []).map((d:any)=>d.id);
  const autonomousContributionsRes = autonomousDebriefIds.length
    ? await db().from("autonomous_service_contributions").select("id,debrief_id,user_id").in("debrief_id",autonomousDebriefIds).eq("user_id",memberIdentityRes.data?.auth_user_id ?? "")
    : {data:[],error:null};
  if (autonomousContributionsRes.error) throw new Error(autonomousContributionsRes.error.message);
  const assignedAutonomousPeriods = new Set(autonomousAssignmentRows.map((a:any)=>a.period_id));
  const completedAutonomousPeriods = new Set(autonomousPeriods.filter((p:any)=>p.status==="completed").map((p:any)=>p.id));
  const autonomousFacts = { assigned: assignedAutonomousPeriods.size, completed: [...assignedAutonomousPeriods].filter((id:string)=>completedAutonomousPeriods.has(id)).length, contributions: (autonomousContributionsRes.data??[]).length, periods: autonomousPeriods.filter((p:any)=>assignedAutonomousPeriods.has(p.id)).map((p:any)=>({title:p.title,status:p.status})) };

  const programs = (programRes.data ?? []).filter((p: any) => p.status !== "cancelled");
  const periodProgramIds = new Set(programs.map((p: any) => p.id));
  const assignments = (assignmentRes.data ?? []).filter((a: any) => periodProgramIds.has(a.program_id));
  const assignmentMembers = assignmentMemberRes.data ?? [];
  const memberAssignmentIds = new Set(assignmentMembers.filter((x: any) => x.member_id === memberId).map((x: any) => x.assignment_id));
  const assignedProgramIds = new Set(assignments.filter((a: any) => memberAssignmentIds.has(a.id)).map((a: any) => a.program_id));

  const attendance = (attendanceRes.data ?? []).filter((a: any) => a.member_id === memberId && periodProgramIds.has(a.program_id));
  const programById = new Map(programs.map((p: any) => [p.id, p]));
  const attendanceDetails = attendance
    .filter((a: any) => ["retard", "absent", "partiel"].includes(a.presence))
    .map((a: any) => {
      const program:any = programById.get(a.program_id);
      return {
        programId: a.program_id,
        programTitle: program?.title ?? "Programme",
        date: program?.start_date ?? null,
        presence: a.presence,
        arrivalTime: a.arrival_time ?? null,
        departureTime: a.departure_time ?? null,
        justified: a.justified ?? null,
        reason: a.justification_reason ?? a.note ?? null,
      };
    })
    .sort((a: any,b: any)=>(b.date??"").localeCompare(a.date??""));
  const attended = attendance.filter((a: any) => ["present", "retard", "partiel", "renfort"].includes(a.presence));
  const late = attendance.filter((a: any) => a.presence === "retard").length;
  const absent = attendance.filter((a: any) => a.presence === "absent").length;
  const partial = attendance.filter((a: any) => a.presence === "partiel").length;
  const present = attendance.filter((a: any) => ["present", "renfort"].includes(a.presence)).length;
  const reinforcements = attendance.filter((a: any) => a.presence === "renfort" || a.is_reinforcement).length;
  const replacements = attendance.filter((a: any) => !!a.replaced_member_id).length;

  const activeSolicitationIds = new Set(
    (solicitationRes.data ?? [])
      .filter((s: any) => !s.cancelled_at && !["cancelled", "annulee", "annulée"].includes(String(s.status ?? "").toLowerCase()))
      .map((s: any) => s.id),
  );
  const solicitationResponses = (solicitationRecipientRes.data ?? []).filter((r: any) => activeSolicitationIds.has(r.solicitation_id));
  const answered = solicitationResponses.filter((r: any) => !!r.responded_at || !["", "pending", "en_attente", "en attente"].includes(String(r.response ?? "pending").toLowerCase())).length;

  const attendedProgramIds = new Set(attended.map((a: any) => a.program_id));
  const relevantDebriefs = (debriefRes.data ?? []).filter((d: any) => attendedProgramIds.has(d.program_id));
  let linkedIncidents = 0;
  for (const debrief of relevantDebriefs) {
    for (const incident of decodeIncidents(debrief.incident_detail)) {
      if (incident.affected_member_id === memberId) linkedIncidents += 1;
    }
  }

  const poles = poleRes.data ?? [];
  const poleName = new Map(poles.map((p: any) => [p.id, p.name]));
  const links = (memberPoleRes.data ?? []).filter((x: any) => x.member_id === memberId);
  const referentPoleIds = links.filter((x: any) => x.is_referent).map((x: any) => x.pole_id);
  const referentPoleSet = new Set(referentPoleIds);

  const paths = pathRes.data ?? [];
  const pathById = new Map(paths.map((p: any) => [p.id, p]));
  const memberPaths = memberPathRes.data ?? [];
  const memberPathIds = memberPaths.map((mp: any) => mp.id);
  const memberStepRes = memberPathIds.length
    ? await db().from("member_training_steps").select("member_training_path_id,step_id,status").in("member_training_path_id", memberPathIds)
    : { data: [], error: null };
  if (memberStepRes.error) throw new Error(memberStepRes.error.message);
  const memberSteps = memberStepRes.data ?? [];
  const definitions = stepRes.data ?? [];

  const training: TrainingMarker[] = memberPaths.map((mp: any) => {
    const path = pathById.get(mp.path_id) as any;
    const required = definitions.filter((s: any) => s.path_id === mp.path_id && s.required !== false);
    const stepRows = memberSteps.filter((s: any) => s.member_training_path_id === mp.id);
    const done = required.filter((definition: any) => stepRows.some((row: any) => row.step_id === definition.id && row.status === "done")).length;
    return {
      pathId: mp.path_id,
      name: path?.name ?? "Parcours",
      poleId: path?.pole_id ?? "",
      poleName: poleName.get(path?.pole_id) ?? "Pôle",
      kind: path?.path_kind === "internal" ? "internal" : "integration",
      status: mp.status,
      progress: required.length ? Math.round((done / required.length) * 100) : (mp.status === "completed" ? 100 : 0),
      startedAt: mp.started_at ?? null,
      completedAt: mp.completed_at ?? null,
    };
  });

  let referent: EvaluationFacts["referent"] = null;
  if (referentPoleIds.length) {
    const poleAssignments = assignments.filter((a: any) => referentPoleSet.has(a.pole_id));
    const poleProgramIds = new Set(poleAssignments.map((a: any) => a.program_id));
    let required = 0;
    let filled = 0;
    for (const assignment of poleAssignments) {
      const assignedCount = assignmentMembers.filter((x: any) => x.assignment_id === assignment.id).length;
      const need = Number(assignment.required_count ?? 0) || assignedCount;
      required += need;
      filled += Math.min(assignedCount, need);
    }

    const allMemberPathsRes = await db().from("member_training_paths").select("member_id,path_id,status,started_at,completed_at");
    if (allMemberPathsRes.error) throw new Error(allMemberPathsRes.error.message);
    const poleTrainingRows = (allMemberPathsRes.data ?? []).filter((mp: any) => {
      const path = pathById.get(mp.path_id) as any;
      if (!path || !referentPoleSet.has(path.pole_id)) return false;
      const started = (mp.started_at ?? "0000-00-00").slice(0, 10);
      const completed = (mp.completed_at ?? "9999-12-31").slice(0, 10);
      return started <= periodEnd && completed >= periodStart;
    });
    const peopleInTraining = new Set(poleTrainingRows.map((mp: any) => mp.member_id)).size;
    const skillsValidated = poleTrainingRows.filter((mp: any) => mp.status === "completed" && mp.completed_at && mp.completed_at.slice(0, 10) >= periodStart && mp.completed_at.slice(0, 10) <= periodEnd).length;
    const replacementsManaged = (attendanceRes.data ?? []).filter((a: any) => poleProgramIds.has(a.program_id) && !!a.replaced_member_id).length;

    referent = {
      referentPoles: referentPoleIds.map((id: string) => poleName.get(id) ?? "Pôle"),
      programsInPoles: poleProgramIds.size,
      coverageRate: pct(filled, required),
      replacementsManaged,
      peopleInTraining,
      skillsValidated,
    };
  }

  return {
    activity: {
      assigned: assignedProgramIds.size,
      attended: attended.length,
      present,
      late,
      absent,
      partial,
    },
    attendanceDetails,
    engagement: { reinforcements, replacements },
    reliability: {
      presenceRate: pct(attended.length, attendance.length),
      responsesAnswered: answered,
      responsesTotal: solicitationResponses.length,
    },
    autonomous: autonomousFacts,
    postService: {
      incidentsExplicitlyLinked: linkedIncidents,
      positiveProgramNotes: relevantDebriefs.filter((d: any) => !!d.went_well?.trim()).length,
      improvementProgramNotes: relevantDebriefs.filter((d: any) => !!d.to_improve?.trim()).length,
    },
    referent,
    training,
    currentFunction: {
      poles: links.map((x: any) => poleName.get(x.pole_id) ?? "Pôle"),
      referentPoles: referentPoleIds.map((id: string) => poleName.get(id) ?? "Pôle"),
    },
  };
}
