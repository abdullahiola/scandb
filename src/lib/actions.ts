"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface FieldDefinition {
  name: string;
  type: "text" | "number" | "date" | "email" | "phone" | "currency" | "url";
  required?: boolean;
}

// ============ COLLECTIONS ============

export async function getCollections() {
  const collections = await prisma.collection.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { documents: true } } },
  });
  return collections;
}

export async function getCollection(id: number) {
  const collection = await prisma.collection.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
  return collection;
}

export async function createCollection(data: {
  name: string;
  description?: string;
  icon?: string;
  schema?: FieldDefinition[];
}) {
  const collection = await prisma.collection.create({
    data: {
      name: data.name,
      description: data.description || "",
      icon: data.icon || "📄",
      schema: JSON.stringify(data.schema || []),
    },
  });
  revalidatePath("/");
  revalidatePath("/collections");
  return collection;
}

export async function updateCollection(
  id: number,
  data: {
    name?: string;
    description?: string;
    icon?: string;
    schema?: FieldDefinition[];
  }
) {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.icon !== undefined) updateData.icon = data.icon;
  if (data.schema !== undefined) updateData.schema = JSON.stringify(data.schema);

  const collection = await prisma.collection.update({
    where: { id },
    data: updateData,
  });
  revalidatePath("/");
  revalidatePath("/collections");
  revalidatePath(`/collections/${id}`);
  return collection;
}

export async function deleteCollection(id: number) {
  await prisma.collection.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/collections");
}

// ============ DOCUMENTS ============

export async function getDocuments(collectionId?: number) {
  const where = collectionId ? { collectionId } : {};
  const documents = await prisma.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { collection: true },
  });
  return documents;
}

export async function getDocument(id: number) {
  const document = await prisma.document.findUnique({
    where: { id },
    include: { collection: true },
  });
  return document;
}

export async function createDocument(data: {
  collectionId: number;
  fileName: string;
  filePath: string;
  rawText: string;
  parsedData: Record<string, unknown>;
  confidence: number;
  status?: string;
}) {
  const document = await prisma.document.create({
    data: {
      collectionId: data.collectionId,
      fileName: data.fileName,
      filePath: data.filePath,
      rawText: data.rawText,
      parsedData: JSON.stringify(data.parsedData),
      confidence: data.confidence,
      status: data.status || "pending",
    },
  });
  revalidatePath("/");
  revalidatePath("/collections");
  revalidatePath(`/collections/${data.collectionId}`);
  return document;
}

export async function updateDocument(
  id: number,
  data: {
    parsedData?: Record<string, unknown>;
    status?: string;
    rawText?: string;
  }
) {
  const updateData: Record<string, unknown> = {};
  if (data.parsedData !== undefined) updateData.parsedData = JSON.stringify(data.parsedData);
  if (data.status !== undefined) updateData.status = data.status;
  if (data.rawText !== undefined) updateData.rawText = data.rawText;

  const document = await prisma.document.update({
    where: { id },
    data: updateData,
  });
  revalidatePath("/");
  revalidatePath(`/documents/${id}`);
  return document;
}

export async function deleteDocument(id: number) {
  const doc = await prisma.document.findUnique({ where: { id } });
  await prisma.document.delete({ where: { id } });
  if (doc) {
    revalidatePath(`/collections/${doc.collectionId}`);
  }
  revalidatePath("/");
}

// ============ STATS ============

export async function getStats() {
  const [totalDocs, totalCollections, pendingDocs, recentDocs] = await Promise.all([
    prisma.document.count(),
    prisma.collection.count(),
    prisma.document.count({ where: { status: "pending" } }),
    prisma.document.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { collection: true },
    }),
  ]);

  const avgConfidence = await prisma.document.aggregate({
    _avg: { confidence: true },
  });

  return {
    totalDocs,
    totalCollections,
    pendingDocs,
    avgConfidence: avgConfidence._avg.confidence || 0,
    recentDocs,
  };
}
