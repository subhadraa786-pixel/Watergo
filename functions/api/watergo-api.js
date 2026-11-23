
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "watergohyderabad@gmail.com";

function corsFor(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };
}

function reply(statusCode, body, env) {
  return {
    statusCode,
    headers: corsFor(env),
    body: JSON.stringify(body)
  };
}

function getClients(env) {
  const url = env.SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anon || !service) {
    throw new Error("Server environment is not configured");
  }

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const adminClient = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  return { authClient, adminClient };
}

async function requireUser(event, clients, env) {
  const header =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    "";

  const token = header.replace(/^Bearer\s+/i, "");

  if (!token) {
    return {
      error: reply(401, { error: "Sign-in required" }, env)
    };
  }

  const { data, error } =
    await clients.authClient.auth.getUser(token);

  if (error || !data?.user) {
    return {
      error: reply(401, {
        error: "Invalid or expired sign-in"
      }, env)
    };
  }

  return { user: data.user };
}

const isAdmin = user =>
  (user.email || "").toLowerCase() === ADMIN_EMAIL;

async function handler(event, env) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsFor(env),
      body: ""
    };
  }

  if (!["GET", "POST"].includes(event.httpMethod)) {
    return reply(405, { error: "Method not allowed" }, env);
  }

  let body = {};

  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return reply(400, { error: "Invalid JSON body" }, env);
  }

  try {
    const clients = getClients(env);
    const auth = await requireUser(event, clients, env);

    if (auth.error) return auth.error;

    const user = auth.user;
    const db = clients.adminClient;
    const action =
      body.action || event.queryStringParameters?.action;

    if (action === "register-supplier") {
      const {
        business_name,
        phone,
        service_areas = [],
        notes = ""
      } = body;

      if (!business_name || !phone) {
        return reply(400, {
          error: "business_name and phone are required"
        }, env);
      }

      const { data, error } =
        await db.from("watergo_supplier_profiles").upsert({
          user_id: user.id,
          email: user.email,
          business_name,
          phone,
          service_areas,
          notes,
          status: "pending"
        }, { onConflict: "user_id" }).select().single();

      if (error) throw error;

      return reply(200, { ok: true, profile: data }, env);
    }

    if (action === "register-delivery-partner") {
      const {
        full_name,
        phone,
        vehicle_type = "",
        service_areas = []
      } = body;

      if (!full_name || !phone) {
        return reply(400, {
          error: "full_name and phone are required"
        }, env);
      }

      const { data, error } =
        await db.from("watergo_delivery_profiles").upsert({
          user_id: user.id,
          email: user.email,
          full_name,
          phone,
          vehicle_type,
          service_areas,
          status: "pending"
        }, { onConflict: "user_id" }).select().single();

      if (error) throw error;

      return reply(200, { ok: true, profile: data }, env);
    }

    if (action === "my-profile") {
      const [supplier, partner] = await Promise.all([
        db.from("watergo_supplier_profiles")
          .select("*").eq("user_id", user.id).maybeSingle(),
        db.from("watergo_delivery_profiles")
          .select("*").eq("user_id", user.id).maybeSingle()
      ]);

      if (supplier.error) throw supplier.error;
      if (partner.error) throw partner.error;

      return reply(200, {
        supplier: supplier.data,
        delivery_partner: partner.data
      }, env);
    }

    if (action === "my-assignments") {
      const { data: rows, error } =
        await db.from("watergo_order_assignments")
          .select("id,order_id,role,status,created_at")
          .eq("assignee_user_id", user.id)
          .order("created_at", { ascending: false });

      if (error) throw error;

      return reply(200, { assignments: rows }, env);
    }

    if (!isAdmin(user) && action !== "update-assignment") {
      return reply(403, {
        error: "Admin access required"
      }, env);
    }

    if (action === "admin-overview") {
      const [suppliers, partners, assignments] =
        await Promise.all([
          db.from("watergo_supplier_profiles")
            .select("*").order("created_at", { ascending: false }),
          db.from("watergo_delivery_profiles")
            .select("*").order("created_at", { ascending: false }),
          db.from("watergo_order_assignments")
            .select("*").order("created_at", { ascending: false })
        ]);

      for (const result of [suppliers, partners, assignments]) {
        if (result.error) throw result.error;
      }

      return reply(200, {
        suppliers: suppliers.data,
        delivery_partners: partners.data,
        assignments: assignments.data
      }, env);
    }

    if (action === "approve-profile") {
      const { role, user_id, status } = body;

      const table =
        role === "supplier"
          ? "watergo_supplier_profiles"
          : role === "delivery"
            ? "watergo_delivery_profiles"
            : null;

      if (
        !table ||
        !user_id ||
        !["approved", "rejected", "pending"].includes(status)
      ) {
        return reply(400, {
          error: "Valid role, user_id and status are required"
        }, env);
      }

      const { data, error } = await db.from(table)
        .update({
          status,
          reviewed_at: new Date().toISOString()
        })
        .eq("user_id", user_id)
        .select()
        .single();

      if (error) throw error;

      return reply(200, { ok: true, profile: data }, env);
    }

    if (action === "assign-order") {
      const { order_id, assignee_user_id, role } = body;

      if (
        !order_id ||
        !assignee_user_id ||
        !["supplier", "delivery"].includes(role)
      ) {
        return reply(400, {
          error: "order_id, assignee_user_id and role are required"
        }, env);
      }

      const table =
        role === "supplier"
          ? "watergo_supplier_profiles"
          : "watergo_delivery_profiles";

      const { data: profile, error: profileError } =
        await db.from(table)
          .select("status")
          .eq("user_id", assignee_user_id)
          .single();

      if (profileError) throw profileError;

      if (profile.status !== "approved") {
        return reply(409, {
          error: "Only approved accounts can receive orders"
        }, env);
      }

      const { data, error } =
        await db.from("watergo_order_assignments").upsert({
          order_id,
          assignee_user_id,
          role,
          status: "assigned",
          assigned_by: user.id
        }, { onConflict: "order_id,role" }).select().single();

      if (error) throw error;

      const { error: eventError } =
        await db.from("watergo_order_events").insert({
          order_id,
          actor_user_id: user.id,
          event_type: "assigned_" + role,
          details: { assignee_user_id }
        });

      if (eventError) throw eventError;

      return reply(200, { ok: true, assignment: data }, env);
    }

    if (action === "admin-update-order-status") {
      if (!isAdmin(user)) {
        return reply(403, {
          error: "Admin access required"
        }, env);
      }

      const { order_id, status } = body;

      const allowedStatuses = [
        "Order placed",
        "Accepted",
        "Ready for pickup",
        "Out for delivery",
        "Delivered",
        "Cancelled"
      ];

      if (!order_id || !allowedStatuses.includes(status)) {
        return reply(400, {
          error: "A valid order_id and allowed status are required"
        }, env);
      }

      const { data: updatedOrder, error: orderError } =
        await db.from("orders")
          .update({ status })
          .eq("id", order_id)
          .select("id,status")
          .maybeSingle();

      if (orderError) throw orderError;

      if (!updatedOrder) {
        return reply(404, { error: "Order not found" }, env);
      }

      const { error: eventError } =
        await db.from("watergo_order_events").insert({
          order_id,
          actor_user_id: user.id,
          event_type: "admin_status_changed",
          details: { status }
        });

      if (eventError) throw eventError;

      return reply(200, {
        ok: true,
        order: updatedOrder
      }, env);
    }

    if (action === "update-assignment") {
      const { assignment_id, status } = body;

      const allowed = [
        "accepted",
        "ready",
        "picked_up",
        "delivered",
        "declined"
      ];

      if (!assignment_id || !allowed.includes(status)) {
        return reply(400, {
          error: "Invalid assignment update"
        }, env);
      }

      let assignmentQuery =
        db.from("watergo_order_assignments")
          .select("id,order_id,assignee_user_id,role,status")
          .eq("id", assignment_id);

      if (!isAdmin(user)) {
        assignmentQuery =
          assignmentQuery.eq("assignee_user_id", user.id);
      }

      const { data: existing, error: lookupError } =
        await assignmentQuery.maybeSingle();

      if (lookupError) throw lookupError;

      if (!existing) {
        return reply(404, {
          error: "Assignment not found for this account"
        }, env);
      }

      const roleAllowed =
        isAdmin(user) ||
        (existing.role === "supplier" &&
          ["accepted", "ready", "declined"].includes(status)) ||
        (existing.role === "delivery" &&
          ["picked_up", "delivered", "declined"].includes(status));

      if (!roleAllowed) {
        return reply(403, {
          error: "This status is not allowed for this assignment role"
        }, env);
      }

      const { data, error } =
        await db.from("watergo_order_assignments")
          .update({
            status,
            updated_at: new Date().toISOString()
          })
          .eq("id", assignment_id)
          .select()
          .single();

      if (error) throw error;

      const customerStatus =
        status === "accepted" ? "Accepted" :
        status === "ready" ? "Ready for pickup" :
        status === "picked_up" ? "Out for delivery" :
        status === "delivered" ? "Delivered" :
        null;

      if (customerStatus) {
        const { error: orderStatusError } =
          await db.from("orders")
            .update({ status: customerStatus })
            .eq("id", data.order_id);

        if (orderStatusError) throw orderStatusError;
      }

      const { error: eventError } =
        await db.from("watergo_order_events").insert({
          order_id: data.order_id,
          actor_user_id: user.id,
          event_type: status,
          details: { assignment_id }
        });

      if (eventError) throw eventError;

      return reply(200, {
        ok: true,
        assignment: data,
        customer_status: customerStatus
      }, env);
    }

    return reply(400, { error: "Unknown action" }, env);

  } catch (error) {
    console.error("WaterGo API error:", error);

    return reply(500, {
      error: "Server error",
      detail:
        env.NODE_ENV === "development"
          ? error.message
          : undefined
    }, env);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const bodyText =
    request.method === "GET" || request.method === "HEAD"
      ? ""
      : await request.text();

  const headers = Object.fromEntries(request.headers.entries());

  const result = await handler({
    httpMethod: request.method,
    headers,
    body: bodyText,
    queryStringParameters:
      Object.fromEntries(url.searchParams.entries())
  }, env);

  return new Response(result.body || null, {
    status: result.statusCode,
    headers: result.headers
  });
}
