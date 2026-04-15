import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

// GET /api/staff — List all staff with document counts
export async function GET() {
  try {
    const staff = await prisma.staff.findMany({
      include: {
        documents: {
          select: {
            id: true,
            documentType: true,
            documentLabel: true,
            fileName: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({ staff });
  } catch (error: any) {
    console.error("Staff list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch staff" },
      { status: 500 }
    );
  }
}

// POST /api/staff — Create or find staff, optionally save a document
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, department, staffId, document } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Staff name is required" },
        { status: 400 }
      );
    }

    // Find or create staff by name (case-insensitive match)
    let staff = await prisma.staff.findFirst({
      where: {
        name: {
          equals: name.trim(),
        },
      },
      include: { documents: true },
    });

    if (!staff) {
      staff = await prisma.staff.create({
        data: {
          name: name.trim(),
          department: department || "",
          staffId: staffId || "",
        },
        include: { documents: true },
      });
    } else {
      // Update department/staffId if provided and currently empty
      const updates: Record<string, string> = {};
      if (department && !staff.department) updates.department = department;
      if (staffId && !staff.staffId) updates.staffId = staffId;

      if (Object.keys(updates).length > 0) {
        staff = await prisma.staff.update({
          where: { id: staff.id },
          data: updates,
          include: { documents: true },
        });
      }
    }

    // If document data provided, save it
    if (document) {
      const doc = await prisma.staffDocument.create({
        data: {
          staffId: staff.id,
          documentType: document.documentType || "unknown",
          documentLabel: document.documentLabel || "",
          fileName: document.fileName || "scan",
          filePath: document.filePath || "",
          rawText: document.rawText || "",
          extractedData: JSON.stringify(document.extractedData || {}),
          fullContent: document.fullContent || "",
          confidence: document.confidence || 0,
          isForm: document.isForm || false,
          status: "reviewed",
        },
      });

      // Re-fetch staff with updated documents
      staff = await prisma.staff.findUnique({
        where: { id: staff.id },
        include: {
          documents: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      return NextResponse.json({ staff, savedDocument: doc });
    }

    return NextResponse.json({ staff });
  } catch (error: any) {
    console.error("Staff create error:", error);
    return NextResponse.json(
      { error: `Failed to create staff: ${error.message}` },
      { status: 500 }
    );
  }
}
