import Redis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { newId } from "@/lib/id";
import { testValkeyUrl } from "@/test/valkey";
import { bullQueue, bullQueueRaw, QUEUE } from "./queue";

const connection = new Redis(testValkeyUrl(), { maxRetriesPerRequest: null });
const queue = bullQueue(QUEUE.maintenance, { connection });
const id = "probe-" + newId();

afterAll(async () => {
  const raw = bullQueueRaw(QUEUE.maintenance);
  await (await raw.getJob(id))?.remove();
  await raw.close();
  await connection.quit();
});

describe("bullQueue", () => {
  it("adds a job with its data and id", async () => {
    await queue.add("probe", { n: 1 }, { jobId: id });
    const job = await bullQueueRaw(QUEUE.maintenance).getJob(id);
    expect(job?.data).toEqual({ n: 1 });
  });

  it("keeps one job when the same id is added twice", async () => {
    await queue.add("probe", { n: 1 }, { jobId: id });
    await queue.add("probe", { n: 2 }, { jobId: id });
    const jobs = await bullQueueRaw(QUEUE.maintenance).getJobs(["waiting", "delayed", "active"]);
    expect(jobs.filter((job) => job.id === id)).toHaveLength(1);
    expect((await bullQueueRaw(QUEUE.maintenance).getJob(id))?.data).toEqual({ n: 1 });
  });
});
